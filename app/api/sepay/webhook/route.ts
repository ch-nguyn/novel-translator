import { timingSafeEqual } from "crypto";
import { recordTransfer } from "../../../lib/server/subscription";

// SePay calls this for every transfer into the bank account
// (https://docs.sepay.vn/tich-hop-webhooks.html), authenticated with
// "Authorization: Apikey <SEPAY_API_KEY>". It retries until it gets
// {"success": true}, so anything not about a plan is acknowledged too.

function authorized(header: string | null): boolean {
  const key = process.env.SEPAY_API_KEY?.trim();
  if (!key || !header) return false;
  const expected = Buffer.from(`Apikey ${key}`);
  const given = Buffer.from(header.trim());
  return given.length === expected.length && timingSafeEqual(given, expected);
}

const ok = () => Response.json({ success: true });

export async function POST(req: Request) {
  if (!authorized(req.headers.get("authorization"))) return Response.json({ success: false }, { status: 401 });
  const body = await req.json().catch(() => null);
  if (!body || typeof body !== "object") return Response.json({ success: false }, { status: 400 });

  // Not set up: SePay retries later
  const account = process.env.SEPAY_BANK_ACCOUNT?.trim();
  if (!account) return Response.json({ success: false }, { status: 503 });
  // Money going out, or into another account linked to SePay
  if (body.transferType !== "in" || String(body.accountNumber ?? "").trim() !== account) return ok();

  const id = Number(body.id);
  const amount = Number(body.transferAmount);
  if (!Number.isSafeInteger(id) || id <= 0 || !Number.isSafeInteger(amount) || amount < 0) {
    return Response.json({ success: false }, { status: 400 });
  }
  const content = typeof body.content === "string" ? body.content : "";
  const result = await recordTransfer({
    id,
    amount,
    content,
    code: typeof body.code === "string" ? body.code : null,
    referenceCode: typeof body.referenceCode === "string" ? body.referenceCode : null,
  });
  if (!result.duplicate) {
    console.log(`[sepay] transfer ${id}: ${amount}đ, ${result.userId ? `${result.months} month(s) for ${result.userId}` : "no matching payment code"}`);
  }
  return ok();
}
