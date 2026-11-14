-- Email addresses the admin lets translate on the app's AI for free, like
-- the monthly plan but without paying (app/lib/server/freeAccess.ts). Kept
-- lower-case; whoever signs in with Google under one of them gets it.
create table if not exists "free_access" (
  "email" text not null primary key,
  "added_by" text not null,
  "created_at" timestamptz not null default now()
);

-- Accounts that chose to translate with their own API key even though they
-- may use the app's AI (for now only the admin can choose, in the Account tab)
create table if not exists "own_key_choice" (
  "user_id" text not null primary key references "user" ("id") on delete cascade,
  "created_at" timestamptz not null default now()
);
