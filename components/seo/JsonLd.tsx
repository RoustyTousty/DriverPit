import type { JsonLdObject } from "@/lib/seo/structuredData";

// The one place structured data reaches the document. A Server Component with
// no state and no interactivity -- it renders a script tag and nothing else.
//
// The `<` escape is the load-bearing line. A JSON-LD payload is injected with
// `dangerouslySetInnerHTML` (there is no other way to emit a script body in
// React), and `JSON.stringify` does not escape `<`, so any value containing
// `</script>` would close the tag early and run whatever followed as markup.
// Today every value here is a literal from our own modules, which is exactly
// the condition that stops being true the day an FAQ answer or a driver name
// flows in from the database. Escaping unconditionally costs nothing and means
// that day is uneventful. `<` is valid inside a JSON string and parses
// back to `<`, so the emitted data is unchanged.
function serialize(data: JsonLdObject): string {
  return JSON.stringify(data).replace(/</g, "\\u003c");
}

export function JsonLd({ data }: { data: JsonLdObject }) {
  return (
    <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: serialize(data) }} />
  );
}
