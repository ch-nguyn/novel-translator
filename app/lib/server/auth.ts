import { betterAuth } from "better-auth";
import { nextCookies } from "better-auth/next-js";
import { Pool } from "pg";

// Accounts, signed in with Google. Signing in is optional: reading with one's
// own API key needs no account. Users, sessions and linked Google accounts are
// kept in Postgres (tables created by `npx @better-auth/cli migrate`).

// Production has no BETTER_AUTH_URL; it uses the project's production domain
const productionUrl = process.env.VERCEL_PROJECT_PRODUCTION_URL && `https://${process.env.VERCEL_PROJECT_PRODUCTION_URL}`;

export const auth = betterAuth({
  baseURL: process.env.BETTER_AUTH_URL || productionUrl || undefined,
  // Neon's URL asks for sslmode=require, which pg already treats as verify-full (and warns about)
  database: new Pool({ connectionString: process.env.DATABASE_URL?.replace("sslmode=require", "sslmode=verify-full"), max: 3 }),
  socialProviders: {
    google: {
      clientId: process.env.GOOGLE_CLIENT_ID!,
      clientSecret: process.env.GOOGLE_CLIENT_SECRET!,
      // Lets someone with several Google accounts pick one
      prompt: "select_account",
    },
  },
  session: {
    expiresIn: 60 * 60 * 24 * 60,
    // The session is checked from a signed cookie for 5 minutes before asking the database again
    cookieCache: { enabled: true, maxAge: 5 * 60 },
  },
  plugins: [nextCookies()],
});
