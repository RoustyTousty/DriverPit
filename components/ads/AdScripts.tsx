import Script from "next/script";

import { getAdsenseClientId, getPublisherId } from "@/components/ads/adsenseConfig";

// Everything here is inert until NEXT_PUBLIC_ADSENSE_CLIENT is set — no
// Google script of any kind is present on the page before that, which is
// the pre-approval / placeholder-only state described in the Ads section.
export function AdScripts() {
  const clientId = getAdsenseClientId();
  if (!clientId) return null;

  const publisherId = getPublisherId(clientId);

  return (
    <>
      {/* Consent Mode v2: must be set before any other Google tag runs, so
          this is the one script on the page allowed to block hydration. */}
      <Script id="consent-default" strategy="beforeInteractive">
        {`
          window.dataLayer = window.dataLayer || [];
          function gtag(){ dataLayer.push(arguments); }
          window.gtag = gtag;
          gtag('consent', 'default', {
            ad_storage: 'denied',
            ad_user_data: 'denied',
            ad_personalization: 'denied',
            analytics_storage: 'denied',
            wait_for_update: 500
          });
        `}
      </Script>

      {/* Google's certified CMP (AdSense -> Privacy & messaging). Shows the
          consent banner itself and calls gtag('consent','update', ...) when
          the visitor responds, or replays a stored decision on return. */}
      <Script
        id="funding-choices"
        strategy="afterInteractive"
        src={`https://fundingchoicesmessages.google.com/i/${publisherId}?ers=1`}
      />
      <Script id="funding-choices-present" strategy="afterInteractive">
        {`
          (function() {
            function signalGooglefcPresent() {
              if (!window.frames['googlefcPresent']) {
                if (document.body) {
                  var iframe = document.createElement('iframe');
                  iframe.style = 'width: 0; height: 0; border: none; z-index: -1000; left: -1000px; top: -1000px;';
                  iframe.style.display = 'none';
                  iframe.name = 'googlefcPresent';
                  document.body.appendChild(iframe);
                } else {
                  setTimeout(signalGooglefcPresent, 0);
                }
              }
            }
            signalGooglefcPresent();
          })();
        `}
      </Script>

      {/* The ad library itself. It reads live consent state per request, so
          loading it doesn't mean it's allowed to serve personalized ads or
          drop ad cookies yet — that's gated by the state above. */}
      <Script
        id="adsbygoogle"
        strategy="afterInteractive"
        src={`https://pagead2.googlesyndication.com/pagead/js/adsbygoogle.js?client=${clientId}`}
        crossOrigin="anonymous"
      />
    </>
  );
}
