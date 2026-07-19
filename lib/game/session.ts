import { createHmac, timingSafeEqual } from "crypto";

export interface RoundPayload {
  driverId: number;
  guessCount: number;
}

function getSecret(): string {
  const secret = process.env.SESSION_SECRET;
  if (!secret) {
    throw new Error("SESSION_SECRET environment variable is not set.");
  }
  return secret;
}

function sign(data: string): string {
  return createHmac("sha256", getSecret()).update(data).digest("base64url");
}

export function signRound(payload: RoundPayload): string {
  const data = Buffer.from(JSON.stringify(payload), "utf-8").toString(
    "base64url",
  );
  return `${data}.${sign(data)}`;
}

export function verifyRound(token: string | undefined): RoundPayload | null {
  if (!token) return null;

  const [data, signature] = token.split(".");
  if (!data || !signature) return null;

  const expected = sign(data);
  const signatureBuffer = Buffer.from(signature);
  const expectedBuffer = Buffer.from(expected);
  if (
    signatureBuffer.length !== expectedBuffer.length ||
    !timingSafeEqual(signatureBuffer, expectedBuffer)
  ) {
    return null;
  }

  try {
    const parsed: unknown = JSON.parse(
      Buffer.from(data, "base64url").toString("utf-8"),
    );
    if (
      typeof parsed === "object" &&
      parsed !== null &&
      "driverId" in parsed &&
      "guessCount" in parsed &&
      typeof parsed.driverId === "number" &&
      typeof parsed.guessCount === "number"
    ) {
      return { driverId: parsed.driverId, guessCount: parsed.guessCount };
    }
    return null;
  } catch {
    return null;
  }
}
