"use client";

import { useEffect, useState } from "react";

import { useAuth } from "@/components/auth/AuthProvider";
import { Modal } from "@/components/ui/Modal";

import { GeneralSection } from "./GeneralSection";
import { ProfileSection } from "./ProfileSection";
import { StatisticsSection } from "./StatisticsSection";

export type SettingsSection = "general" | "profile" | "statistics";

const SECTIONS: { value: SettingsSection; label: string }[] = [
  { value: "general", label: "General" },
  { value: "profile", label: "Profile" },
  { value: "statistics", label: "Statistics" },
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
        {profile?.isGuest && (
          <div className="flex items-center justify-between gap-3 rounded-lg border border-accent-weak bg-accent-weak/40 p-3">
            <div>
              <p className="text-sm font-semibold text-accent">Save your progress</p>
              <p className="text-xs text-text-muted">Create an account so your stats and streak follow you across devices.</p>
            </div>
            {section !== "profile" && (
              <button
                type="button"
                onClick={() => setSection("profile")}
                className="shrink-0 rounded-lg bg-accent px-3 py-1.5 text-xs font-semibold text-bg transition hover:brightness-110 motion-safe:active:scale-[0.98]"
              >
                Sign up
              </button>
            )}
          </div>
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
        {section === "profile" && <ProfileSection />}
        {section === "statistics" && <StatisticsSection />}
      </div>
    </Modal>
  );
}
