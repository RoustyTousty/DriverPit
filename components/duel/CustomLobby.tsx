"use client";

import { useState } from "react";

import type { DriverWithActivity } from "@/lib/db/queries";
import { createCustomLobby } from "@/lib/duel/customLobby";
import type { MatchResult } from "@/lib/duel/matchmaking";
import type { DriverFilter } from "@/lib/game/driverFilter";

import { CustomLobbyCreate } from "./CustomLobbyCreate";
import { CustomLobbyJoin } from "./CustomLobbyJoin";
import { CustomLobbyWaiting } from "./CustomLobbyWaiting";

// The whole custom-lobby flow, self-contained. It owns its own sub-phase and
// reports a MatchResult upward -- the SAME contract DuelSearching has -- so
// DuelRoot's diff for this entire feature is one phase string, one deep-link
// read and one branch. Everything downstream of onMatchFound (staging, the
// ready-gate, the countdown, the match, the results) is the existing duel path
// unchanged, because a custom match is an ordinary duel_matches row.
//
// HOST AND JOIN ARE TABS, NOT A MENU. There used to be a third sub-phase -- a
// two-card "create or join?" screen -- which cost a click and, worse, hid half
// the feature behind it: someone arriving with a code in hand had to first
// answer a question they already knew the answer to. Two tabs put both on
// screen at once and make switching free, which matters because "wait, did they
// send me a code or am I making one?" is a real moment. Same tablist styling as
// SettingsModal and the leaderboard, so a tab looks like a tab everywhere.
type SubPhase = "compose" | "waiting";
type Tab = "create" | "join";

export function CustomLobby({
  allDrivers,
  referenceYear,
  initialJoinCode,
  onMatchFound,
  onBack,
}: {
  allDrivers: DriverWithActivity[];
  referenceYear: number;
  // Present when /online?join=CODE brought us here, which also decides the
  // opening tab -- a link should land on the join form, not on the host's.
  initialJoinCode?: string;
  onMatchFound: (match: MatchResult) => void;
  onBack: () => void;
}) {
  const [subPhase, setSubPhase] = useState<SubPhase>("compose");
  const [tab, setTab] = useState<Tab>(initialJoinCode ? "join" : "create");
  // Just the code: the waiting screen no longer restates the config, so there
  // is nothing else to carry across.
  const [lobbyCode, setLobbyCode] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);
  const [createError, setCreateError] = useState<string | null>(null);

  async function handleCreate(config: { rounds: number; roundSeconds: number; filter: DriverFilter }) {
    setCreating(true);
    setCreateError(null);

    const result = await createCustomLobby(config);
    setCreating(false);
    if (!result.ok) {
      setCreateError(result.error);
      return;
    }

    setLobbyCode(result.code);
    setSubPhase("waiting");
  }

  // Waiting takes the whole screen rather than sitting under the tabs: the
  // lobby EXISTS at that point, a code is out in the world, and offering a
  // "Join" tab beside it would invite the host to abandon it by accident.
  if (subPhase === "waiting" && lobbyCode) {
    return (
      <CustomLobbyWaiting
        code={lobbyCode}
        onMatchFound={onMatchFound}
        onCancel={() => {
          setLobbyCode(null);
          setSubPhase("compose");
          setTab("create");
        }}
      />
    );
  }

  return (
    <div className="flex flex-col gap-5 px-4 py-6">
      <header className="flex flex-col gap-1">
        <h1 className="text-xl font-bold text-text">Custom game</h1>
        <p className="text-sm text-text-muted">
          Play someone you know. Nothing here counts toward your rating, record or the leaderboard.
        </p>
      </header>

      <div
        role="tablist"
        aria-label="Custom game"
        className="flex gap-1 rounded-lg border border-border bg-surface-2 p-1"
      >
        {(
          [
            { value: "create", label: "Host" },
            { value: "join", label: "Join" },
          ] as const
        ).map((option) => {
          const active = option.value === tab;
          return (
            <button
              key={option.value}
              type="button"
              role="tab"
              aria-selected={active}
              aria-controls="custom-lobby-panel"
              onClick={() => setTab(option.value)}
              className={`flex-1 rounded-md px-3 py-1.5 text-sm font-semibold transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent ${
                active ? "bg-accent-weak text-accent" : "text-text-muted hover:text-text"
              }`}
            >
              {option.label}
            </button>
          );
        })}
      </div>

      <div id="custom-lobby-panel" role="tabpanel">
        {tab === "create" ? (
          <CustomLobbyCreate
            allDrivers={allDrivers}
            referenceYear={referenceYear}
            pending={creating}
            error={createError}
            onCreate={(config) => void handleCreate(config)}
          />
        ) : (
          <CustomLobbyJoin
            allDrivers={allDrivers}
            initialCode={initialJoinCode}
            referenceYear={referenceYear}
            onMatchFound={onMatchFound}
          />
        )}
      </div>

      <button
        type="button"
        onClick={onBack}
        className="w-full rounded-lg px-4 py-2 text-sm font-semibold text-text-muted transition hover:text-text focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent"
      >
        Back to modes
      </button>
    </div>
  );
}
