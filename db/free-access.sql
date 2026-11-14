-- Email addresses the admin lets translate on the app's AI for free, like
-- the monthly plan but without paying (app/lib/server/freeAccess.ts). Kept
-- lower-case; whoever signs in with Google under one of them gets it.
create table if not exists "free_access" (
  "email" text not null primary key,
  "added_by" text not null,
  "created_at" timestamptz not null default now()
);
