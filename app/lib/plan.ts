// The monthly plan: translating on the app's AI with no key and no limit

export const PLAN_PRICE_VND = 49_000;
export const PLAN_DAYS = 30;
// Whether the app offers the plan. Closed: nothing in the app tells of it or
// takes payment; accounts that already paid keep translating on it until it
// runs out, and see until when.
export const PLAN_OPEN = false;

// What the server says about the signed-in user's plan (GET /api/subscription)
export interface SubscriptionStatus {
  active: boolean;
  // Milliseconds; null when never paid
  paidUntil: number | null;
  // How to pay; null when payments are not set up
  payment: {
    bank: string;
    account: string;
    accountName: string;
    amount: number;
    // The transfer note that identifies the user
    content: string;
    qrUrl: string;
  } | null;
}

// Error a translation on the plan reports instead of the AI provider's own
// message (which may name the model, the key or a quota); shown as
// t.aiUnavailable
export const AI_UNAVAILABLE_ERROR = "AI_UNAVAILABLE";
