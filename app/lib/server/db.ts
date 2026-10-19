import { Pool } from "pg";

// The Postgres database (Neon) holding accounts and their settings.
// Neon's URL asks for sslmode=require, which pg already treats as verify-full (and warns about).
// A stalled connection or query gives up instead of holding one of the few
// connections (sign-in, the plan and payments wait on them) until the function times out.
export const pool = new Pool({
  connectionString: process.env.DATABASE_URL?.replace("sslmode=require", "sslmode=verify-full"),
  max: 3,
  connectionTimeoutMillis: 10_000,
  query_timeout: 15_000,
});

// A dropped idle connection is replaced on the next query; unhandled, it would crash the server
pool.on("error", (e) => console.error(`[db] ${e.message}`));
