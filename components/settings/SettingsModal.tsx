"use client";

import { useEffect, useState } from "react";

import { useAuth } from "@/components/auth/AuthProvider";
import { GuestUpgradePrompt } from "@/components/auth/GuestUpgradePrompt";
import { Modal } from "@/components/ui/Modal";

import { GeneralSection } from "./GeneralSection";
import { ProfileSection } from "./ProfileSection";
import { StatisticsSection } from "./StatisticsSection";

export type SettingsSection = "general" | "profile" | "statistics";

const SECTIONS: { value: SettingsSection; label: string }[] = [
  { value: "general", label: "General" },
  { value: "statistics", label: "Statistics" },
  { value: "profile", label: "Profile" },
];

export function SettingsModal({
  open,
  onClose,
  initialSection = "general",
}: {
  open: boolean;
  onClose: () => void;
  initialSection?: SettingsSection;
}) {
  const { profile } = useAuth();
  const [section, setSection] = useState<SettingsSection>(initialSection);

  useEffect(() => {
    if (open) setSection(initialSection);
  }, [open, initialSection]);

  return (
    <Modal open={open} onClose={onClose} title="Settings">
      <div className="flex flex-col gap-5">
        {/* Shown on every section, and now on Profile too: the button used to be
            hidden there because Profile WAS the destination. It is a page of its
            own now (/auth/sign-in), so the prompt has somewhere to send a guest
            from every tab. */}
        {profile?.isGuest && (
          <GuestUpgradePrompt description="Create an account so your stats and streak follow you across devices." />
        )}

        <div role="tablist" aria-label="Settings section" className="flex gap-1 rounded-lg border border-border bg-surface-2 p-1">
          {SECTIONS.map((tab) => {
            const active = tab.value === section;
            return (
              <button
                key={tab.value}
                type="button"
                role="tab"
                aria-selected={active}
                onClick={() => setSection(tab.value)}
                className={`flex-1 rounded-md px-3 py-1.5 text-sm font-semibold transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent ${
                  active ? "bg-accent-weak text-accent" : "text-text-muted hover:text-text"
                }`}
              >
                {tab.label}
              </button>
            );
          })}
        </div>

        {section === "general" && <GeneralSection />}
        {section === "statistics" && <StatisticsSection />}
        {section === "profile" && <ProfileSection />}
      </div>
    </Modal>
  );
}
