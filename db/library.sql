-- A signed-in user's bookshelf (app/lib/server/library.ts), so it follows them
-- to every device: the novels, where they are in each, and each novel's
-- names. `updated_at` is when the row last changed on a device, in
-- milliseconds, and `device` which device that was; a row takes a place
-- further along, or a later change (app/lib/readingPlace.ts).
create table if not exists "library_novel" (
  "user_id" text not null references "user" ("id") on delete cascade,
  "slug" text not null,
  "name" text not null,
  "url" text not null,
  "chapter_title" text not null,
  "paragraph" integer not null,
  -- Deleted; kept so the deletion reaches the user's other devices
  "removed" boolean not null,
  "updated_at" bigint not null,
  "device" text not null default '',
  primary key ("user_id", "slug")
);
alter table "library_novel" add column if not exists "device" text not null default '';

create table if not exists "library_glossary" (
  "user_id" text not null references "user" ("id") on delete cascade,
  "slug" text not null,
  "terms" jsonb not null,
  "updated_at" bigint not null,
  primary key ("user_id", "slug")
);
