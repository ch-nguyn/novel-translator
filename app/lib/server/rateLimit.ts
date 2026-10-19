import { getRedis } from "./jobs";

// Limits on what anyone, signed in or not, can make the server do: fetch
// pages from the novel sites (and, when a site hides behind Cloudflare, run a
// headless browser for it). Counted per IP address, generously, since many
// readers on a mobile network can share one. Nothing is limited when Redis is
// not set up or cannot be reached.

const RELEASE_IF_OWNED = `if redis.call('GET', KEYS[1]) == ARGV[1] then return redis.call('DEL', KEYS[1]) end return 0`;
// One more in the count at KEYS[1], which lasts ARGV[1] seconds from its first
const COUNT = `local n = redis.call('INCR', KEYS[1]) if redis.call('TTL', KEYS[1]) < 0 then redis.call('EXPIRE', KEYS[1], ARGV[1]) end return n`;
// Takes the first free of the slots KEYS for ARGV[2] seconds; its number, or 0
const TAKE_SLOT = `for i, key in ipairs(KEYS) do if redis.call('SET', key, ARGV[1], 'NX', 'EX', ARGV[2]) then return i end end return 0`;

// Redis not answering soon is Redis failing: readers are not kept waiting on it
const REDIS_TIMEOUT_MS = 1500;

class RedisTimeout extends Error {}

export function soon<T>(promise: Promise<T>): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  return Promise.race([
    promise,
    new Promise<never>((_, reject) => {
      timer = setTimeout(() => reject(new RedisTimeout()), REDIS_TIMEOUT_MS);
    }),
  ]).finally(() => clearTimeout(timer));
}

// The address a request came from (Vercel puts the client's first)
export function clientIp(req: Request): string {
  const forwarded = req.headers.get("x-forwarded-for")?.split(",")[0]?.trim();
  return forwarded || req.headers.get("x-real-ip")?.trim() || "unknown";
}

// Counts one more use of `bucket` by `who`; false once more than `limit`
// were counted in the current `windowSeconds`
export async function allow(bucket: string, who: string, limit: number, windowSeconds: number): Promise<boolean> {
  const db = getRedis();
  if (!db) return true;
  const key = `rl:${bucket}:${who}:${Math.floor(Date.now() / 1000 / windowSeconds)}`;
  try {
    return (await count(key, windowSeconds)) <= limit;
  } catch {
    return true;
  }
}

// One more in the count at `key`, which is dropped `seconds` after its first.
// Throws when Redis fails or is missing.
export async function count(key: string, seconds: number): Promise<number> {
  const db = getRedis();
  if (!db) throw new Error("Redis is not set up");
  return soon(db.eval<string[], number>(COUNT, [key], [String(seconds)]));
}

// Requests one address may make a minute, by what they make the server do.
// A reader opens a chapter every few minutes; a search asks every site.
const PER_MINUTE = {
  fetch: 60,
  toc: 60,
  search: 20,
};

// A 429 answer when the request's address went over its limit for `bucket`
export async function limitRequest(req: Request, bucket: keyof typeof PER_MINUTE): Promise<Response | null> {
  if (await allow(bucket, clientIp(req), PER_MINUTE[bucket], 60)) return null;
  return Response.json(
    { error: "Too many requests from your network. Please wait a minute and try again." },
    { status: 429, headers: { "Retry-After": "60" } }
  );
}

// Headless browsers running at once across all of the app's servers: each
// takes a lot of memory and time, and many at once look like an attack to
// the sites
const BROWSER_SLOTS = ["browser:slot:1", "browser:slot:2", "browser:slot:3"];
// A slot frees itself after this long, in case its server died. Longer than
// a browser run can take (see fetchWithPuppeteer).
const BROWSER_SLOT_SECONDS = 150;
const BROWSER_WAIT_MS = 15_000;
// Browser runs one address may cause (a reader needs it for a few chapters
// of a site behind Cloudflare at most)
const BROWSER_RUNS_PER_IP = 20;
const BROWSER_RUNS_WINDOW_SECONDS = 10 * 60;

export class BrowserBusyError extends Error {}
export class BrowserLimitError extends Error {}

// Runs `work` with one of the browser slots, waiting a little for one to free
// up. `ip`: the address that asked for it (none for background translations,
// which only run for readers with an AI key or the plan); only runs that get
// a slot count against it.
export async function withBrowserSlot<T>(ip: string | undefined, work: () => Promise<T>): Promise<T> {
  let release: () => Promise<void>;
  try {
    const taken = await takeSlot(BROWSER_SLOTS, BROWSER_SLOT_SECONDS, BROWSER_WAIT_MS);
    if (!taken) throw new BrowserBusyError();
    release = taken;
  } catch (e) {
    if (e instanceof BrowserBusyError) throw e;
    // Redis failed: run without a slot rather than fail the reader
    return work();
  }
  try {
    if (ip && !(await allow("browser", ip, BROWSER_RUNS_PER_IP, BROWSER_RUNS_WINDOW_SECONDS))) throw new BrowserLimitError();
    return await work();
  } finally {
    await release();
  }
}

const SLOT_RETRY_MS = 2000;

// Takes one of `slots` (Redis keys) for at most `seconds`, waiting up to
// `waitMs` for one to free up. Returns how to give it back, or null when all
// stayed taken. With no Redis, a slot that does nothing; throws when Redis fails.
export async function takeSlot(slots: string[], seconds: number, waitMs: number): Promise<(() => Promise<void>) | null> {
  const db = getRedis();
  if (!db) return async () => {};
  const token = crypto.randomUUID();
  const deadline = Date.now() + waitMs;
  const release = (slot: number) => async () => {
    await soon(db.eval(RELEASE_IF_OWNED, [slots[slot - 1]], [token])).catch(() => {});
  };
  for (;;) {
    const taking = db.eval<string[], number>(TAKE_SLOT, slots, [token, String(seconds)]);
    let slot: number;
    try {
      slot = await soon(taking);
    } catch (e) {
      // Redis answered too late: a slot it gave meanwhile is given back
      taking.then((late) => (late ? release(late)() : undefined)).catch(() => {});
      throw e;
    }
    if (slot) return release(slot);
    if (Date.now() + SLOT_RETRY_MS > deadline) return null;
    await new Promise((resolve) => setTimeout(resolve, SLOT_RETRY_MS));
  }
}
