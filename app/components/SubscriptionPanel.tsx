"use client";

import { useEffect, useRef, useState } from "react";
import { Translations } from "../lib/i18n";
import { PLAN_DAYS, PLAN_PRICE_VND, SubscriptionStatus } from "../lib/plan";

interface Props {
  textColor: string;
  t: Translations;
  lang: string;
  // The plan started or was extended
  onPaid: () => void;
}

// While the payment details are shown, the plan is asked for this often
const POLL_MS = 4000;
// Waiting this long, the payer is told what to do if the money left their account
const SLOW_PAYMENT_MS = 3 * 60_000;

export const formatPrice = (vnd: number) => new Intl.NumberFormat("vi-VN").format(vnd);

async function loadStatus(signal?: AbortSignal): Promise<SubscriptionStatus> {
  const res = await fetch("/api/subscription", { cache: "no-store", signal });
  if (!res.ok) throw new Error(`subscription ${res.status}`);
  return res.json();
}

// The signed-in user's monthly plan, and the bank transfer that pays for it
export default function SubscriptionPanel({ textColor, t, lang, onPaid }: Props) {
  const [status, setStatus] = useState<SubscriptionStatus | null>(null);
  const [failed, setFailed] = useState(false);
  const [paying, setPaying] = useState(false);
  const [paid, setPaid] = useState(false);
  // Bumped to load the plan again after a failure
  const [attempt, setAttempt] = useState(0);
  // The last check for the transfer failed (offline...)
  const [checkFailed, setCheckFailed] = useState(false);
  const [slow, setSlow] = useState(false);
  const onPaidRef = useRef(onPaid);
  onPaidRef.current = onPaid;

  useEffect(() => {
    const controller = new AbortController();
    setFailed(false);
    loadStatus(controller.signal).then(
      (loaded) => {
        setStatus(loaded);
        // Paid while the details were closed: the app may still ask for a key
        if (loaded.active) onPaidRef.current();
      },
      () => !controller.signal.aborted && setFailed(true)
    );
    return () => controller.abort();
  }, [attempt]);

  // Watches for the transfer while the payment details are open
  const paidUntil = status?.paidUntil ?? null;
  useEffect(() => {
    if (!paying) return;
    const controller = new AbortController();
    const timer = setInterval(() => {
      loadStatus(controller.signal)
        .then((next) => {
          setCheckFailed(false);
          if ((next.paidUntil ?? 0) <= (paidUntil ?? 0)) return;
          setStatus(next);
          setPaying(false);
          setPaid(true);
          onPaidRef.current();
        })
        .catch(() => !controller.signal.aborted && setCheckFailed(true));
    }, POLL_MS);
    const slowTimer = setTimeout(() => setSlow(true), SLOW_PAYMENT_MS);
    return () => {
      clearInterval(timer);
      clearTimeout(slowTimer);
      controller.abort();
    };
  }, [paying, paidUntil]);

  const muted = textColor + "80";
  const price = formatPrice(PLAN_PRICE_VND);
  const date = (ms: number) => new Date(ms).toLocaleDateString(lang === "vi" ? "vi-VN" : "en-GB");

  return (
    <section className="flex flex-col gap-3 p-4 rounded-xl border" style={{ borderColor: textColor + "25" }} aria-label={t.planName}>
      <div className="flex items-baseline justify-between gap-3">
        <h3 className="text-sm font-semibold">{t.planName}</h3>
        <span className="text-sm font-semibold">{t.planPrice.replace("{price}", price).replace("{days}", String(PLAN_DAYS))}</span>
      </div>
      <p className="text-sm" style={{ color: muted }}>{t.planPerks}</p>

      {!status && !failed && <p className="text-sm" style={{ color: muted }}>{t.planLoading}</p>}
      {failed && !status && (
        <div role="alert" className="flex items-center justify-between gap-3">
          <p className="text-sm text-red-600">{t.planLoadFailed}</p>
          <button
            onClick={() => setAttempt((n) => n + 1)}
            className="shrink-0 px-3 py-1.5 rounded-lg border text-sm cursor-pointer hover:opacity-70"
            style={{ borderColor: textColor + "30" }}
          >
            {t.retry}
          </button>
        </div>
      )}
      {status && (
        <>
          {status.paidUntil && (
            <p className={`text-sm font-medium ${status.active ? "text-green-600" : ""}`} style={status.active ? undefined : { color: muted }}>
              {(status.active ? t.planActiveUntil : t.planExpired).replace("{date}", date(status.paidUntil))}
            </p>
          )}
          {paid && <p role="status" className="text-sm font-medium text-green-600">{t.planActivated}</p>}
          {!status.payment ? (
            <p className="text-sm" style={{ color: muted }}>{t.planUnavailable}</p>
          ) : paying ? (
            <PaymentDetails payment={status.payment} textColor={textColor} t={t} checkFailed={checkFailed} slow={slow} />
          ) : (
            <button
              onClick={() => {
                setPaid(false);
                setCheckFailed(false);
                setSlow(false);
                setPaying(true);
              }}
              className="self-start px-4 py-2 rounded-lg text-sm font-medium cursor-pointer text-white bg-blue-600 hover:bg-blue-700"
            >
              {status.paidUntil ? t.planRenew : t.planSubscribe}
            </button>
          )}
        </>
      )}
    </section>
  );
}

function PaymentDetails({
  payment,
  textColor,
  t,
  checkFailed,
  slow,
}: {
  payment: NonNullable<SubscriptionStatus["payment"]>;
  textColor: string;
  t: Translations;
  checkFailed: boolean;
  slow: boolean;
}) {
  const rows: [string, string, boolean][] = [
    [t.planBank, payment.bank, false],
    [t.planAccount, payment.account, true],
    ...(payment.accountName ? [[t.planAccountName, payment.accountName, false] as [string, string, boolean]] : []),
    [t.planAmount, `${formatPrice(payment.amount)}đ`, false],
    [t.planContent, payment.content, true],
  ];
  return (
    <div className="flex flex-col gap-3">
      <div>
        <p className="text-sm font-medium">{t.planPayTitle}</p>
        <p className="text-xs mt-1" style={{ color: textColor + "80" }}>{t.planQrOnPhone}</p>
      </div>
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img src={payment.qrUrl} alt={t.planPayTitle} width={240} height={240} className="self-center w-60 h-60 rounded-lg bg-white" />
      <dl className="flex flex-col gap-1.5 text-sm">
        {rows.map(([label, value, copyable]) => (
          <div key={label} className="flex items-center justify-between gap-3">
            <dt className="min-w-0" style={{ color: textColor + "80" }}>{label}</dt>
            <dd className={`flex items-center gap-2 font-medium text-right ${copyable ? "whitespace-nowrap" : "break-words"}`}>
              {value}
              {copyable && <CopyButton value={value} label={label} textColor={textColor} t={t} />}
            </dd>
          </div>
        ))}
      </dl>
      <p className="text-xs" style={{ color: textColor + "80" }}>{t.planPayNote}</p>
      <p role="status" className={`text-sm ${checkFailed ? "text-red-600" : "animate-pulse"}`} style={checkFailed ? undefined : { color: textColor + "99" }}>
        {checkFailed ? t.planCheckFailed : t.planWaiting}
      </p>
      {slow && <p className="text-xs" style={{ color: textColor + "99" }}>{t.planSlow.replace("{code}", payment.content)}</p>}
    </div>
  );
}

function CopyButton({ value, label, textColor, t }: { value: string; label: string; textColor: string; t: Translations }) {
  const [result, setResult] = useState<"copied" | "failed" | null>(null);
  const show = (next: "copied" | "failed") => {
    setResult(next);
    setTimeout(() => setResult(null), 2000);
  };
  return (
    <button
      onClick={() => {
        if (!navigator.clipboard) return show("failed");
        navigator.clipboard.writeText(value).then(() => show("copied"), () => show("failed"));
      }}
      aria-label={`${t.copy}: ${label}`}
      className="shrink-0 min-h-8 px-3 py-1 rounded border text-xs font-normal cursor-pointer hover:opacity-70"
      style={{ borderColor: result === "failed" ? "#dc262680" : textColor + "30" }}
    >
      <span aria-live="polite">{result === "copied" ? t.copied : result === "failed" ? t.copyFailed : t.copy}</span>
    </button>
  );
}
