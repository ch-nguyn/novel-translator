import { randomInt } from "crypto";
import { PLAN_DAYS, PLAN_PRICE_VND, SubscriptionStatus } from "../plan";
import { pool } from "./db";

// The monthly plan, paid by bank transfer through SePay (see db/subscription.sql).
// The transfer note carries the user's payment code; every PLAN_PRICE_VND in
// the transfer adds PLAN_DAYS to the plan.

const CODE_PREFIX = "NT";
// No look-alikes (0/O, 1/I/L) in case a code is typed by hand
const CODE_ALPHABET = "ABCDEFGHJKMNPQRSTUVWXYZ23456789";
const CODE_LENGTH = 8;
// A whole word: "OTHERNTABCDEFGHXYZ" is not the code NTABCDEFGH
const CODE_PATTERN = new RegExp(`(?<![A-Z0-9])${CODE_PREFIX}[${CODE_ALPHABET}]{${CODE_LENGTH}}(?![A-Z0-9])`, "g");

function newPaymentCode(): string {
  return CODE_PREFIX + Array.from({ length: CODE_LENGTH }, () => CODE_ALPHABET[randomInt(CODE_ALPHABET.length)]).join("");
}

// The payment code in a transfer note; null when there is none, or more than
// one (the transfer is then sorted out by hand)
export function findPaymentCode(text: string): string | null {
  const codes = new Set(text.toUpperCase().match(CODE_PATTERN) ?? []);
  return codes.size === 1 ? [...codes][0] : null;
}

export async function isSubscribed(userId: string): Promise<boolean> {
  const { rows } = await pool.query(`select 1 from "subscription" where "user_id" = $1 and "paid_until" > now()`, [userId]);
  return rows.length > 0;
}

// The user's payment code, created on first use
async function paymentCode(userId: string): Promise<{ code: string; paidUntil: Date | null }> {
  for (let attempt = 0; ; attempt++) {
    try {
      const { rows } = await pool.query(
        `insert into "subscription" ("user_id", "payment_code") values ($1, $2)
         on conflict ("user_id") do update set "user_id" = excluded."user_id"
         returning "payment_code", "paid_until"`,
        [userId, newPaymentCode()]
      );
      return { code: rows[0].payment_code, paidUntil: rows[0].paid_until };
    } catch (e) {
      // Another user has this code already: draw again
      const taken = (e as { code?: string }).code === "23505";
      if (!taken || attempt >= 3) throw e;
    }
  }
}

// Where to transfer to; null (no payments offered) unless SePay can also
// report the transfers
function paymentSettings() {
  const account = process.env.SEPAY_BANK_ACCOUNT?.trim();
  const bank = process.env.SEPAY_BANK?.trim();
  if (!account || !bank || !process.env.SEPAY_API_KEY?.trim()) return null;
  return { account, bank, accountName: process.env.SEPAY_ACCOUNT_NAME?.trim() ?? "" };
}

export async function subscriptionStatus(userId: string): Promise<SubscriptionStatus> {
  const { code, paidUntil } = await paymentCode(userId);
  const until = paidUntil ? paidUntil.getTime() : null;
  const settings = paymentSettings();
  const qr = settings && new URLSearchParams({ acc: settings.account, bank: settings.bank, amount: String(PLAN_PRICE_VND), des: code });
  return {
    active: until !== null && until > Date.now(),
    paidUntil: until,
    payment: settings && { ...settings, amount: PLAN_PRICE_VND, content: code, qrUrl: `https://qr.sepay.vn/img?${qr}` },
  };
}

export interface IncomingTransfer {
  id: number;
  amount: number;
  // Transfer note, and the code SePay recognized in it
  content: string;
  code?: string | null;
  referenceCode?: string | null;
}

// Records a transfer and extends the plan of the user whose code it carries.
// A transfer already recorded (SePay retrying) changes nothing.
export async function recordTransfer(transfer: IncomingTransfer): Promise<{ userId: string | null; months: number; duplicate: boolean }> {
  // SePay's own reading of the code, else the note
  const code = (transfer.code && findPaymentCode(transfer.code)) || findPaymentCode(transfer.content);
  const months = Math.floor(transfer.amount / PLAN_PRICE_VND);
  const client = await pool.connect();
  try {
    await client.query("begin");
    const owner = code ? await client.query(`select "user_id" from "subscription" where "payment_code" = $1 for update`, [code]) : null;
    const userId: string | null = owner?.rows[0]?.user_id ?? null;
    const inserted = await client.query(
      `insert into "payment" ("id", "user_id", "amount", "content", "reference_code", "months") values ($1, $2, $3, $4, $5, $6)
       on conflict ("id") do nothing returning "id"`,
      [transfer.id, userId, transfer.amount, transfer.content.slice(0, 500), transfer.referenceCode ?? null, months]
    );
    const duplicate = inserted.rows.length === 0;
    if (!duplicate && userId && months > 0) {
      await client.query(
        `update "subscription" set "paid_until" = greatest(coalesce("paid_until", now()), now()) + make_interval(days => $2), "updated_at" = now()
         where "user_id" = $1`,
        [userId, months * PLAN_DAYS]
      );
    }
    await client.query("commit");
    return { userId, months, duplicate };
  } catch (e) {
    await client.query("rollback").catch(() => {});
    throw e;
  } finally {
    client.release();
  }
}
