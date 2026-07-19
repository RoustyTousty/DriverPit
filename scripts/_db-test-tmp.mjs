import "dotenv/config";
import postgres from "postgres";

const sql = postgres(process.env.DATABASE_URL, { prepare: false, connect_timeout: 8 });
try {
  const result = await sql`delete from daily_puzzles`;
  console.log("Deleted", result.count, "rows from daily_puzzles.");
} catch (err) {
  console.log("QUERY FAILED:", err.message);
} finally {
  await sql.end({ timeout: 1 });
}
