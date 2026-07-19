// Fixed palette for the preset-N avatar keys assigned by the signup
// trigger (see drizzle/0006_auth_trigger_rls.sql) -- no real avatar image
// assets exist yet, so this is a stand-in: a colored circle with the
// username's first letter, keyed off the same preset number so it's at
// least stable per user.
const PRESET_COLORS = [
  "#FF6A00",
  "#2E7D46",
  "#3B82F6",
  "#A855F7",
  "#EC4899",
  "#F59E0B",
  "#14B8A6",
  "#EF4444",
];

function presetColor(avatarUrl: string): string {
  const match = /preset-(\d+)/.exec(avatarUrl);
  const n = match ? parseInt(match[1], 10) : 1;
  return PRESET_COLORS[(n - 1) % PRESET_COLORS.length];
}

const SIZE_CLASSES = {
  sm: "h-7 w-7 text-xs",
  md: "h-10 w-10 text-sm",
} as const;

export function AvatarGlyph({
  username,
  avatarUrl,
  size = "md",
}: {
  username: string;
  avatarUrl: string;
  size?: keyof typeof SIZE_CLASSES;
}) {
  return (
    <div
      className={`flex shrink-0 items-center justify-center rounded-full font-bold text-white ${SIZE_CLASSES[size]}`}
      style={{ backgroundColor: presetColor(avatarUrl) }}
      aria-hidden="true"
    >
      {username.replace(/^user/, "").charAt(0).toUpperCase() || "?"}
    </div>
  );
}
