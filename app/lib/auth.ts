import { createAuthClient } from "better-auth/react";

// The browser's side of sign-in (app/lib/server/auth.ts)
export const authClient = createAuthClient();

export function signInWithGoogle() {
  return authClient.signIn.social({ provider: "google", callbackURL: "/" });
}
