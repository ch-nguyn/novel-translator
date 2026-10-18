"use client";

import { useState } from "react";
import { Translations } from "../lib/i18n";
import { authClient, signInWithGoogle } from "../lib/auth";
import { PLAN_PRICE_VND } from "../lib/plan";
import SubscriptionPanel, { formatPrice } from "./SubscriptionPanel";

interface Props {
  textColor: string;
  t: Translations;
  lang: string;
  // The user's access to the app's AI may have changed (plan paid)
  onAccessChange: () => void;
}

// Signing in with Google, or the signed-in account and its monthly plan
export default function AccountPanel({ textColor, t, lang, onAccessChange }: Props) {
  const { data: session, isPending } = authClient.useSession();
  const [busy, setBusy] = useState(false);
  const [failed, setFailed] = useState(false);
  const user = session?.user;

  async function signIn() {
    setBusy(true);
    setFailed(false);
    // On success the browser leaves for Google, so `busy` stays on
    const { error } = await signInWithGoogle().catch(() => ({ error: true }));
    if (error) {
      setBusy(false);
      setFailed(true);
    }
  }

  async function signOut() {
    setBusy(true);
    await authClient.signOut().catch(() => {});
    setBusy(false);
  }

  return (
    <div className="flex flex-col gap-5">
      {isPending ? (
        <p className="text-sm animate-pulse" style={{ color: textColor + "60" }}>…</p>
      ) : user ? (
        <div className="flex items-center gap-3">
          {user.image ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={user.image} alt="" referrerPolicy="no-referrer" className="w-11 h-11 rounded-full shrink-0" />
          ) : (
            <span className="w-11 h-11 rounded-full shrink-0 flex items-center justify-center text-lg font-semibold" style={{ backgroundColor: textColor + "15" }}>
              {(user.name || user.email).charAt(0).toUpperCase()}
            </span>
          )}
          <div className="flex-1 min-w-0">
            <p className="text-sm font-semibold truncate">{user.name}</p>
            <p className="text-xs truncate" style={{ color: textColor + "80" }}>{user.email}</p>
          </div>
          <button
            onClick={signOut}
            disabled={busy}
            className="shrink-0 px-3 py-1.5 rounded-lg border text-sm cursor-pointer hover:opacity-70 disabled:opacity-50"
            style={{ borderColor: textColor + "30" }}
          >
            {t.signOut}
          </button>
        </div>
      ) : null}
      {user && <SubscriptionPanel key={user.id} textColor={textColor} t={t} lang={lang} onPaid={onAccessChange} />}
      {!isPending && !user && (
        <div className="flex flex-col gap-3">
          <button
            onClick={signIn}
            disabled={busy}
            className="flex items-center justify-center gap-2 px-4 py-2.5 rounded-lg border text-sm font-medium cursor-pointer bg-white text-gray-800 hover:bg-gray-50 disabled:opacity-60"
            style={{ borderColor: textColor + "30" }}
          >
            <GoogleLogo />
            {t.signInGoogle}
          </button>
          {failed && <p role="alert" className="text-sm text-red-600">{t.signInFailed}</p>}
          <p className="text-sm">{t.planSignIn.replace("{price}", formatPrice(PLAN_PRICE_VND))}</p>
          <p className="text-xs" style={{ color: textColor + "80" }}>{t.accountNote}</p>
        </div>
      )}
      <p className="flex gap-4 text-xs" style={{ color: textColor + "80" }}>
        <a href="/privacy" className="underline hover:opacity-70">{t.privacy}</a>
        <a href="/terms" className="underline hover:opacity-70">{t.terms}</a>
      </p>
    </div>
  );
}

function GoogleLogo() {
  return (
    <svg width="18" height="18" viewBox="0 0 48 48" aria-hidden="true">
      <path fill="#FFC107" d="M43.6 20.5H42V20H24v8h11.3C33.7 32.7 29.2 36 24 36c-6.6 0-12-5.4-12-12s5.4-12 12-12c3.1 0 5.8 1.2 7.9 3.1l5.7-5.7C34 6.1 29.3 4 24 4 12.9 4 4 12.9 4 24s8.9 20 20 20 20-8.9 20-20c0-1.3-.1-2.4-.4-3.5z" />
      <path fill="#FF3D00" d="M6.3 14.7l6.6 4.8C14.7 15.1 19 12 24 12c3.1 0 5.8 1.2 7.9 3.1l5.7-5.7C34 6.1 29.3 4 24 4 16.3 4 9.7 8.3 6.3 14.7z" />
      <path fill="#4CAF50" d="M24 44c5.2 0 9.9-2 13.4-5.2l-6.2-5.2C29.2 35.1 26.7 36 24 36c-5.2 0-9.6-3.3-11.3-7.9l-6.5 5C9.5 39.6 16.2 44 24 44z" />
      <path fill="#1976D2" d="M43.6 20.5H42V20H24v8h11.3c-.8 2.2-2.2 4.2-4.1 5.6l6.2 5.2C37 39.2 44 34 44 24c0-1.3-.1-2.4-.4-3.5z" />
    </svg>
  );
}
