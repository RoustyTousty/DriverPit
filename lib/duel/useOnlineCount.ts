"use client";

import { useEffect, useState } from "react";

import { useAuth } from "@/components/auth/AuthProvider";
import { createSupabaseBrowserClient } from "@/lib/supabase/browser";

import { LOBBY_CHANNEL } from "./matchmaking";

// Live count of everyone currently on the `lobby` presence channel --
// backs the online count on the /online landing (CLAUDE.md: "shows a live
// online count (presence)") and the searching screen. Each mount tracks its
// own short-lived presence entry rather than sharing one subscription
// app-wide; that's cheap and self-heals instantly on unmount/remount
// (landing -> searching -> back), same as MatchmakingLobby's existing
// online-count logic this factors out.
export function useOnlineCount(): number {
  const { user } = useAuth();
  const [count, setCount] = useState(1);

  useEffect(() => {
    if (!user) return;

    const supabase = createSupabaseBrowserClient();
    const channel = supabase.channel(LOBBY_CHANNEL, {
      config: { presence: { key: user.id } },
    });

    channel
      .on("presence", { event: "sync" }, () => {
        setCount(Object.keys(channel.presenceState()).length);
      })
      .subscribe((status) => {
        if (status === "SUBSCRIBED") void channel.track({});
      });

    return () => {
      void supabase.removeChannel(channel);
    };
  }, [user]);

  return count;
}
