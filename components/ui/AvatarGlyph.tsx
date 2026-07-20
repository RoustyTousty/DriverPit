"use client";

import { useMemo } from "react";

import { renderAvatarSvg } from "@/lib/avatars";

const SIZE_CLASSES = {
  sm: "h-7 w-7",
  md: "h-10 w-10",
  lg: "h-14 w-14",
} as const;

export function AvatarGlyph({
  avatarUrl,
  size = "md",
}: {
  avatarUrl: string;
  size?: keyof typeof SIZE_CLASSES;
}) {
  const svg = useMemo(() => renderAvatarSvg(avatarUrl), [avatarUrl]);

  return (
    <div
      className={`shrink-0 overflow-hidden rounded-full bg-surface-2 [&>svg]:block [&>svg]:h-full [&>svg]:w-full ${SIZE_CLASSES[size]}`}
      aria-hidden="true"
      dangerouslySetInnerHTML={{ __html: svg }}
    />
  );
}
