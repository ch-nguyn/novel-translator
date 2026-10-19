import { createAuthClient } from "better-auth/react";

// The browser's side of sign-in (app/lib/server/auth.ts)
export const authClient = createAuthClient();

export function signInWithGoogle() {
  // Back on the account tab, where the user signed in (see app/page.tsx)
  return authClient.signIn.social({ provider: "google", callbackURL: `/?${SIGNED_IN_PARAM}` });
}

// Added to the URL the app returns to after signing in
export const SIGNED_IN_PARAM = "signed-in";
