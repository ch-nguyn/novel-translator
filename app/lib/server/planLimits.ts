import { count, takeSlot } from "./rateLimit";
import { ApiError } from "./apiError";

// What the monthly plan's AI (the app's key) is used for: translating the
// chapters of the novel sites, not any text. A reader never notices these:
// their chapters are fetched by the server itself, and they translate one at
// a time (plus the few the app translates ahead).

// Chapters (and name lists) one account translates at once on the app's AI.
// Reading takes one, a few devices or a jump to another chapter one or two more.
const SLOTS_PER_USER = 4;
// A slot frees itself after this long, in case its server died. Longer than
// any translation may run (the routes' maxDuration).
const SLOT_SECONDS = 330;
// A user's custom instructions added to the translation prompt
export const MAX_PLAN_CUSTOM_PROMPT = 2000;
// Chapters one account translated today that are worth a look (logged as
// "[plan-heavy]", then again at every multiple)
const HEAVY_DAY = 500;

export class PlanBusyError extends ApiError {
  constructor() {
    super("planBusy", "Too many chapters are being translated at once on your account. Please wait for them to finish.", 429);
  }
}

// The slots could not be counted (Redis failing): nothing would limit the
// account's use of the app's AI then
export class PlanSlotsUnavailableError extends ApiError {
  constructor() {
    super("busy", "Translation on the plan is unavailable for a moment. Please try again in a few minutes.", 503);
  }
}

// Takes one of the user's slots, waiting up to `waitMs`. Returns how to give
// it back; throws PlanBusyError when they all stayed taken, and
// PlanSlotsUnavailableError when Redis fails.
export async function takePlanSlot(userId: string, waitMs = 0): Promise<() => Promise<void>> {
  const slots = Array.from({ length: SLOTS_PER_USER }, (_, i) => `plan:${userId}:slot:${i + 1}`);
  let release: (() => Promise<void>) | null;
  try {
    release = await takeSlot(slots, SLOT_SECONDS, waitMs);
  } catch (e) {
    console.error(`[plan] no slot, Redis failed: ${e instanceof Error ? e.message : e}`);
    throw new PlanSlotsUnavailableError();
  }
  if (!release) throw new PlanBusyError();
  return release;
}

const WAIT_RETRY_MS = 2000;

// Waits up to `waitMs` for one of the user's slots while `wanted()` (the
// chapter is still asked for). Returns how to give it back, or null once it
// is no longer wanted; throws PlanBusyError when they all stayed taken.
export async function waitForPlanSlot(userId: string, waitMs: number, wanted: () => Promise<boolean>): Promise<(() => Promise<void>) | null> {
  const deadline = Date.now() + waitMs;
  for (;;) {
    try {
      return await takePlanSlot(userId);
    } catch (e) {
      if (!(e instanceof PlanBusyError) || Date.now() + WAIT_RETRY_MS > deadline) throw e;
    }
    await new Promise((resolve) => setTimeout(resolve, WAIT_RETRY_MS));
    if (!(await wanted())) return null;
  }
}

// Counts a chapter translated for the user today (UTC), and logs the accounts
// that translate far more than anyone reads
export async function countPlanChapter(userId: string): Promise<void> {
  try {
    const today = await count(`plan:${userId}:chapters:${new Date().toISOString().slice(0, 10)}`, 2 * 24 * 3600);
    if (today % HEAVY_DAY === 0) console.error(`[plan-heavy] user ${userId} translated ${today} chapters today on the app's AI`);
  } catch {
    // Only a count
  }
}

// The custom instructions kept for a translation on the app's AI
export function planCustomPrompt(customPrompt: unknown): string | undefined {
  return typeof customPrompt === "string" ? customPrompt.slice(0, MAX_PLAN_CUSTOM_PROMPT) : undefined;
}

// A stream that gives `release` back once it is read to the end, fails or is cancelled
export function releasingStream(stream: ReadableStream<Uint8Array>, release: () => Promise<void>): ReadableStream<Uint8Array> {
  const reader = stream.getReader();
  let released = false;
  const done = () => {
    if (released) return;
    released = true;
    release().catch(() => {});
  };
  return new ReadableStream<Uint8Array>({
    async pull(controller) {
      try {
        const { done: finished, value } = await reader.read();
        if (finished) {
          done();
          controller.close();
        } else {
          controller.enqueue(value);
        }
      } catch (e) {
        done();
        controller.error(e);
      }
    },
    async cancel(reason) {
      done();
      await reader.cancel(reason).catch(() => {});
    },
  });
}
