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
      // rounded-lg, not rounded-full: an avatar is a tile like everything else
      // on the site, and it carries the same radius as every card, input and
      // button rather than being the one circle in the layout. This is the ONLY
      // place the avatar's shape is decided -- anything that draws a ring, glow
      // or placeholder around one (OpponentPanel, AvatarPicker, the empty
      // leaderboard and matchmaking slots) has to match it, or the decoration
      // and the avatar disagree.
      className={`shrink-0 overflow-hidden rounded-lg bg-surface-2 [&>svg]:block [&>svg]:h-full [&>svg]:w-full ${SIZE_CLASSES[size]}`}
      aria-hidden="true"
      dangerouslySetInnerHTML={{ __html: svg }}
    />
  );
}
