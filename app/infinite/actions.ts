"use server";

import { cookies } from "next/headers";

import {
  getDriverById,
  getRandomPoolDriverId,
  toDriverSummary,
  toGameDriver,
  type DriverSummary,
} from "@/lib/db/queries";
import { compare, isWin, type GuessResult } from "@/lib/game/compare";
import { DEFAULT_POOL_WINDOW, isPoolWindow } from "@/lib/game/poolWindow";
import { signRound, verifyRound } from "@/lib/game/session";

const ROUND_COOKIE = "infinite_round";
const MAX_GUESSES = 5;
const ROUND_MAX_AGE_SECONDS = 60 * 60;

async function setRoundCookie(driverId: number, guessCount: number) {
  const store = await cookies();
  store.set(ROUND_COOKIE, signRound({ driverId, guessCount }), {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    path: "/",
    maxAge: ROUND_MAX_AGE_SECONDS,
  });
}

// The client sends its chosen pool window along; validated here rather
// than trusted, since it's just an untyped value coming over the wire.
export async function startInfiniteRound(poolWindow?: unknown): Promise<void> {
  const window = isPoolWindow(poolWindow) ? poolWindow : DEFAULT_POOL_WINDOW;
  const driverId = await getRandomPoolDriverId(window, new Date().getUTCFullYear());
  await setRoundCookie(driverId, 0);
}

export type SubmitGuessResult =
  | {
      ok: true;
      guessedDriver: DriverSummary;
      result: GuessResult;
      status: "won" | "lost" | "continue";
      target?: DriverSummary;
    }
  | { ok: false; error: string };

export async function submitGuess(
  guessedDriverId: number,
): Promise<SubmitGuessResult> {
  const store = await cookies();
  const round = verifyRound(store.get(ROUND_COOKIE)?.value);

  if (!round) {
    return {
      ok: false,
      error: "Your round expired. Start a new driver to keep playing.",
    };
  }
  if (round.guessCount >= MAX_GUESSES) {
    return { ok: false, error: "No guesses left." };
  }

  const [guessedRow, targetRow] = await Promise.all([
    getDriverById(guessedDriverId),
    getDriverById(round.driverId),
  ]);

  if (!guessedRow) {
    return { ok: false, error: "Pick a driver from the suggestions list." };
  }
  if (!targetRow) {
    return {
      ok: false,
      error: "Round is no longer valid. Start a new driver.",
    };
  }

  const today = new Date();
  const result = compare(
    toGameDriver(guessedRow),
    toGameDriver(targetRow),
    today,
  );
  const guessCount = round.guessCount + 1;
  const won = isWin(result);
  const status: "won" | "lost" | "continue" = won
    ? "won"
    : guessCount >= MAX_GUESSES
      ? "lost"
      : "continue";

  const guessedDriver = toDriverSummary(guessedRow, today);

  if (status === "continue") {
    await setRoundCookie(round.driverId, guessCount);
    return { ok: true, guessedDriver, result, status };
  }

  store.delete(ROUND_COOKIE);
  return {
    ok: true,
    guessedDriver,
    result,
    status,
    target: toDriverSummary(targetRow, today),
  };
}
