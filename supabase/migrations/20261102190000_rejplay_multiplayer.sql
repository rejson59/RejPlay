-- RejPlay · multiplayer na Supabase `rejson-widgets` (hzbqzfimtroixnldzjeq)
-- Zastosowano przez Supabase MCP: create_migration("rejplay_multiplayer").
-- UWAGA: w frontendzie używamy WYŁĄCZNIE klucza publishable/anon.

create table if not exists public.rejplay_profiles (
  client_id text primary key,
  nick text not null default 'Gracz',
  color text not null default '#c8a06a',
  appearance jsonb not null default '{}'::jsonb,
  updated_at timestamptz not null default now()
);

create table if not exists public.rejplay_events (
  id bigint generated always as identity primary key,
  client_id text,
  nick text,
  kind text not null,
  detail text not null default '',
  created_at timestamptz not null default now()
);

create table if not exists public.rejplay_chat (
  id bigint generated always as identity primary key,
  client_id text not null,
  nick text not null,
  color text not null default '#c8a06a',
  content text not null check (char_length(content) between 1 and 180),
  created_at timestamptz not null default now()
);

create index if not exists rejplay_chat_created_at_idx on public.rejplay_chat (created_at desc);
create index if not exists rejplay_events_created_at_idx on public.rejplay_events (created_at desc);

alter table public.rejplay_profiles enable row level security;
alter table public.rejplay_events enable row level security;
alter table public.rejplay_chat enable row level security;

drop policy if exists rejplay_profiles_public on public.rejplay_profiles;
create policy rejplay_profiles_public on public.rejplay_profiles
  for all to anon, authenticated using (true) with check (true);

drop policy if exists rejplay_events_public on public.rejplay_events;
create policy rejplay_events_public on public.rejplay_events
  for all to anon, authenticated using (true) with check (true);

drop policy if exists rejplay_chat_public on public.rejplay_chat;
create policy rejplay_chat_public on public.rejplay_chat
  for all to anon, authenticated using (true) with check (true);

do $$
begin
  if not exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'rejplay_chat'
  ) then
    alter publication supabase_realtime add table public.rejplay_chat;
  end if;
  if not exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'rejplay_events'
  ) then
    alter publication supabase_realtime add table public.rejplay_events;
  end if;
end $$;
