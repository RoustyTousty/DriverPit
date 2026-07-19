// Preset avatar icons -- profiles.avatar_url holds "preset-1".."preset-8"
// (assigned randomly at signup by the auth trigger, drizzle/0006_*.sql;
// re-assignable afterward via the Settings avatar picker). No file uploads,
// no Storage bucket -- a fixed, curated set of racing-themed glyphs, each
// paired with one of the app's existing avatar colors so nobody's avatar
// color shifts if they had one from before this picker existed.
export interface AvatarPreset {
  id: string;
  label: string;
  color: string;
  icon: React.ReactNode;
}

const HELMET_ICON = (
  <>
    <path d="M4 15a8 8 0 0 1 16 0v3a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2v-3Z" />
    <rect x="4" y="13.5" width="16" height="3" />
  </>
);
const WHEEL_ICON = (
  <>
    <circle cx="12" cy="12" r="8" />
    <circle cx="12" cy="12" r="2.25" />
    <path d="M12 4v5.75M8.4 16.9l2.25-3.24M15.6 16.9l-2.25-3.24" />
  </>
);
const FLAG_ICON = <path d="M5 3v18h2v-6h11l-2.5-4L18 7H7V3H5Z" />;
const BOLT_ICON = <path d="M13 2 4 14h6l-1 8 9-12h-6l1-8Z" />;
const TROPHY_ICON = (
  <>
    <path d="M7 4h10v5a5 5 0 0 1-10 0V4Z" />
    <path d="M7 5.5H4.5A1.5 1.5 0 0 0 3 7a4 4 0 0 0 4 4M17 5.5h2.5A1.5 1.5 0 0 1 21 7a4 4 0 0 1-4 4" />
    <rect x="10.5" y="13.5" width="3" height="4" />
    <rect x="8" y="19" width="8" height="2" />
  </>
);
const STAR_ICON = <path d="M12 2.5 14.9 9l7.1.6-5.4 4.7 1.7 6.9L12 17.3l-6.3 3.9 1.7-6.9L2 9.6 9.1 9 12 2.5Z" />;
const TIRE_ICON = (
  <>
    <circle cx="12" cy="12" r="9" />
    <circle cx="12" cy="12" r="3.5" />
    <path d="M12 3v3M12 18v3M21 12h-3M6 12H3M18.4 5.6l-2.1 2.1M7.7 16.3l-2.1 2.1M18.4 18.4l-2.1-2.1M7.7 7.7 5.6 5.6" />
  </>
);
const PODIUM_ICON = (
  <>
    <rect x="3" y="13" width="5.5" height="8" />
    <rect x="9.25" y="8" width="5.5" height="13" />
    <rect x="15.5" y="15.5" width="5.5" height="5.5" />
  </>
);

export const AVATAR_PRESETS: AvatarPreset[] = [
  { id: "preset-1", label: "Helmet", color: "#FF6A00", icon: HELMET_ICON },
  { id: "preset-2", label: "Podium", color: "#2E7D46", icon: PODIUM_ICON },
  { id: "preset-3", label: "Wheel", color: "#3B82F6", icon: WHEEL_ICON },
  { id: "preset-4", label: "Star", color: "#A855F7", icon: STAR_ICON },
  { id: "preset-5", label: "Flag", color: "#EC4899", icon: FLAG_ICON },
  { id: "preset-6", label: "Trophy", color: "#F59E0B", icon: TROPHY_ICON },
  { id: "preset-7", label: "Tire", color: "#14B8A6", icon: TIRE_ICON },
  { id: "preset-8", label: "Bolt", color: "#EF4444", icon: BOLT_ICON },
];

const DEFAULT_PRESET = AVATAR_PRESETS[0];

export function getAvatarPreset(avatarUrl: string): AvatarPreset {
  return AVATAR_PRESETS.find((preset) => preset.id === avatarUrl) ?? DEFAULT_PRESET;
}
