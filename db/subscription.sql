-- The monthly plan (app/lib/server/subscription.ts). Each user gets a
-- payment code to put in the bank transfer; SePay reports the transfer and
-- the plan runs until `paid_until`.
create table if not exists "subscription" (
  "user_id" text not null primary key references "user" ("id") on delete cascade,
  "payment_code" text not null unique,
  "paid_until" timestamptz,
  "updated_at" timestamptz not null default now()
);

-- Every incoming transfer SePay reported, by SePay's transaction id (so a
-- retried webhook is counted once). `user_id` is null when the transfer
-- carried no known payment code.
create table if not exists "payment" (
  "id" bigint not null primary key,
  "user_id" text references "user" ("id") on delete set null,
  "amount" bigint not null,
  "content" text not null,
  "reference_code" text,
  "months" integer not null,
  "created_at" timestamptz not null default now()
);
