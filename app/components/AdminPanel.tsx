"use client";

import { FormEvent, useEffect, useState } from "react";
import { Translations } from "../lib/i18n";

interface Props {
  textColor: string;
  t: Translations;
  lang: string;
}

interface Entry {
  email: string;
  addedAt: number;
}

const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

async function send(method: "GET" | "POST" | "DELETE", email?: string, signal?: AbortSignal): Promise<Entry[]> {
  const res = await fetch("/api/admin/free-access", {
    method,
    cache: "no-store",
    signal,
    ...(email ? { headers: { "Content-Type": "application/json" }, body: JSON.stringify({ email }) } : {}),
  });
  if (!res.ok) throw new Error(`free-access ${res.status}`);
  return (await res.json()).entries;
}

// For the admin: the email addresses given free use of the app's AI
export default function AdminPanel({ textColor, t, lang }: Props) {
  const [entries, setEntries] = useState<Entry[] | null>(null);
  const [loadFailed, setLoadFailed] = useState(false);
  const [attempt, setAttempt] = useState(0);
  const [email, setEmail] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const muted = textColor + "80";

  useEffect(() => {
    const controller = new AbortController();
    setLoadFailed(false);
    send("GET", undefined, controller.signal).then(setEntries, () => !controller.signal.aborted && setLoadFailed(true));
    return () => controller.abort();
  }, [attempt]);

  async function change(method: "POST" | "DELETE", target: string) {
    setBusy(true);
    setError(null);
    try {
      setEntries(await send(method, target));
      if (method === "POST") setEmail("");
    } catch {
      setError(t.adminFailed);
    } finally {
      setBusy(false);
    }
  }

  function add(e: FormEvent) {
    e.preventDefault();
    if (busy || !entries) return;
    const target = email.trim().toLowerCase();
    if (!EMAIL_PATTERN.test(target)) return setError(t.adminInvalidEmail);
    change("POST", target);
  }

  const date = (ms: number) => new Date(ms).toLocaleDateString(lang === "vi" ? "vi-VN" : "en-GB");

  return (
    <section className="flex flex-col gap-3 p-4 rounded-xl border" style={{ borderColor: textColor + "25" }} aria-label={t.adminTitle}>
      <h3 className="text-sm font-semibold">{t.adminTitle}</h3>
      <p className="text-xs" style={{ color: muted }}>{t.adminNote}</p>
      <form onSubmit={add} className="flex gap-2">
        <input
          type="email"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          placeholder="name@gmail.com"
          aria-label={t.adminEmailLabel}
          autoComplete="off"
          className="flex-1 min-w-0 px-3 py-2 rounded-lg border text-sm bg-transparent"
          style={{ borderColor: textColor + "30" }}
        />
        <button
          type="submit"
          // Not before the list is loaded: its answer would overwrite the change
          disabled={busy || !entries || !email.trim()}
          className="shrink-0 px-4 py-2 rounded-lg text-sm font-medium cursor-pointer text-white bg-blue-600 hover:bg-blue-700 disabled:opacity-50"
        >
          {t.adminAdd}
        </button>
      </form>
      {error && <p role="alert" className="text-sm text-red-600">{error}</p>}
      {!entries && !loadFailed && <p className="text-sm animate-pulse" style={{ color: muted }}>…</p>}
      {loadFailed && !entries && (
        <div role="alert" className="flex items-center justify-between gap-3">
          <p className="text-sm text-red-600">{t.adminLoadFailed}</p>
          <button
            onClick={() => setAttempt((n) => n + 1)}
            className="shrink-0 px-3 py-1.5 rounded-lg border text-sm cursor-pointer hover:opacity-70"
            style={{ borderColor: textColor + "30" }}
          >
            {t.retry}
          </button>
        </div>
      )}
      {entries && entries.length === 0 && <p className="text-sm" style={{ color: muted }}>{t.adminEmpty}</p>}
      {entries && entries.length > 0 && (
        <ul className="flex flex-col gap-1.5">
          {entries.map((entry) => (
            <li key={entry.email} className="flex items-center justify-between gap-3 text-sm">
              <span className="min-w-0 break-all">
                {entry.email}
                <span className="ml-2 text-xs" style={{ color: muted }}>{date(entry.addedAt)}</span>
              </span>
              <button
                onClick={() => change("DELETE", entry.email)}
                disabled={busy}
                aria-label={`${t.adminRemove}: ${entry.email}`}
                className="shrink-0 px-3 py-1 rounded border text-xs cursor-pointer hover:opacity-70 disabled:opacity-50"
                style={{ borderColor: textColor + "30" }}
              >
                {t.adminRemove}
              </button>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
