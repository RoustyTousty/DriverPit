import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";

import * as schema from "./schema";

// Supabase's pooled connection (port 6543) runs PgBouncer in transaction
// mode, which doesn't support prepared statements — postgres.js uses them
// by default, so every parameterized query fails without this.
export const client = postgres(process.env.DATABASE_URL!, { prepare: false });

export const db = drizzle(client, { schema });
