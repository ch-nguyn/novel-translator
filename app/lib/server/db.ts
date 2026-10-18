import { Pool } from "pg";

// The Postgres database (Neon) holding accounts and their settings.
// Neon's URL asks for sslmode=require, which pg already treats as verify-full (and warns about).
export const pool = new Pool({ connectionString: process.env.DATABASE_URL?.replace("sslmode=require", "sslmode=verify-full"), max: 3 });
