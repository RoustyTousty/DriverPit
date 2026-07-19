import { getAvatarPreset } from "@/lib/avatars";

const SIZE_CLASSES = {
  sm: "h-7 w-7",
  md: "h-10 w-10",
  lg: "h-14 w-14",
} as const;

const ICON_SIZE_CLASSES = {
  sm: "h-4 w-4",
  md: "h-5.5 w-5.5",
  lg: "h-8 w-8",
} as const;

export function AvatarGlyph({
  avatarUrl,
  size = "md",
}: {
  avatarUrl: string;
  size?: keyof typeof SIZE_CLASSES;
}) {
  const preset = getAvatarPreset(avatarUrl);
  return (
    <div
      className={`flex shrink-0 items-center justify-center rounded-full ${SIZE_CLASSES[size]}`}
      style={{ backgroundColor: preset.color }}
      aria-hidden="true"
    >
      <svg viewBox="0 0 24 24" fill="white" className={ICON_SIZE_CLASSES[size]}>
        {preset.icon}
      </svg>
    </div>
  );
}
