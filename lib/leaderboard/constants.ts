// How many rows each board shows -- and therefore how many getLeaderboard
// fetches. One constant rather than two, because the two numbers were never
// independent and had drifted apart: the action fetched 50 per board while the
// modal rendered 10, so 100 rows crossed the wire for 20 rendered (audit
// 2026-07-29 §1.6).
//
// The drift wasn't only waste. getLeaderboard suppresses the "you're #N" row
// for a viewer already visible in the fetched rows, so a player ranked 11-50
// was counted as "already visible" and then rendered nowhere -- neither in the
// top slots nor beneath them. Tying both sides to this one number is what makes
// "already visible" mean what it says.
export const LEADERBOARD_TOP_SLOTS = 10;
