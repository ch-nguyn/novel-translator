-- Each signed-in user's settings (app/lib/server/userSettings.ts). API keys
-- in `settings` are encrypted. `updated_at` is when the user last changed
-- them, in milliseconds.
create table if not exists "user_settings" (
  "user_id" text not null primary key references "user" ("id") on delete cascade,
  "settings" jsonb not null,
  "updated_at" bigint not null
);
