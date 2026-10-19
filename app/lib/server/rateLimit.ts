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

function soon<T>(promise: Promise<T>): Promise<T> {
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
    return (await soon(db.eval<string[], number>(COUNT, [key], [String(windowSeconds)]))) <= limit;
  } catch {
    return true;
  }
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
const BROWSER_RETRY_MS = 2000;
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
  const db = getRedis();
  if (!db) return work();
  const token = crypto.randomUUID();
  let slot = 0;
  try {
    const deadline = Date.now() + BROWSER_WAIT_MS;
    for (;;) {
      slot = await soon(db.eval<string[], number>(TAKE_SLOT, BROWSER_SLOTS, [token, String(BROWSER_SLOT_SECONDS)]));
      if (slot) break;
      if (Date.now() + BROWSER_RETRY_MS > deadline) throw new BrowserBusyError();
      await new Promise((resolve) => setTimeout(resolve, BROWSER_RETRY_MS));
    }
  } catch (e) {
    if (e instanceof BrowserBusyError) throw e;
    // Redis failed: run without a slot rather than fail the reader
    return work();
  }
  try {
    if (ip && !(await allow("browser", ip, BROWSER_RUNS_PER_IP, BROWSER_RUNS_WINDOW_SECONDS))) throw new BrowserLimitError();
    return await work();
  } finally {
    await soon(db.eval(RELEASE_IF_OWNED, [BROWSER_SLOTS[slot - 1]], [token])).catch(() => {});
  }
}
