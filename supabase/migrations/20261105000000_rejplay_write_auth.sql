-- RejPlay v0.7.1 · autoryzacja zapisu w tabelach multiplayer
-- Zastosowano w projekcie `rejson-widgets` (hzbqzfimtroixnldzjeq).
--
-- Problem: migracja 20261102190000 nadała anonimowym klientom politykę
-- `for all ... using (true) with check (true)`. Każdy, kto zna publiczny klucz
-- `anon` (a jest on w bundle'u), mógł pisać czat cudzym nickiem, nadpisywać
-- profile i dowolnie sypać zdarzenia. Drużyny dostały już poprawkę w
-- 20261104191000; tu domykamy pozostałe trzy tabele.
--
-- Rozwiązanie: RLS pozwala wyłącznie czytać. Zapis przechodzi przez trzy
-- SECURITY DEFINER RPC, które walidują token sesji rejson59.github.io przez
-- istniejącą funkcję `rejplay_party_user(p_token)` (zwraca NULL przy błędzie).
-- Funkcje działają jako właściciel tabel, więc omijają RLS świadomie.

alter table public.rejplay_chat add column if not exists user_id uuid;
alter table public.rejplay_events add column if not exists user_id uuid;
alter table public.rejplay_profiles add column if not exists user_id uuid;

create index if not exists rejplay_chat_user_created_idx
  on public.rejplay_chat (user_id, created_at desc);
create index if not exists rejplay_events_user_created_idx
  on public.rejplay_events (user_id, created_at desc);

-- 1. Usuwamy pełny dostęp, zostawiamy jawny odczyt (kanał realtime też go używa).
drop policy if exists rejplay_chat_public on public.rejplay_chat;
drop policy if exists rejplay_events_public on public.rejplay_events;
drop policy if exists rejplay_profiles_public on public.rejplay_profiles;

create policy rejplay_chat_read on public.rejplay_chat
  for select to anon, authenticated using (true);
create policy rejplay_events_read on public.rejplay_events
  for select to anon, authenticated using (true);
create policy rejplay_profiles_read on public.rejplay_profiles
  for select to anon, authenticated using (true);

-- 2. Czat: nick, kolor, długość i częstotliwość walidowane po stronie bazy.
create or replace function public.rejplay_chat_send(
  p_token text, p_client_id text, p_nick text, p_color text,
  p_content text, p_party_code text default null
)
returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  v_user record;
  v_content text;
  v_nick text;
  v_color text;
  v_client text;
  v_party text;
  v_id bigint;
begin
  select * into v_user from public.rejplay_party_user(p_token);
  if v_user.user_id is null then
    return jsonb_build_object('ok', false, 'error', 'Sesja konta wygasła. Zaloguj się ponownie.');
  end if;

  v_content := btrim(coalesce(p_content, ''));
  if char_length(v_content) < 1 or char_length(v_content) > 180 then
    return jsonb_build_object('ok', false, 'error', 'Wiadomość musi mieć 1–180 znaków.');
  end if;
  v_nick := left(btrim(coalesce(p_nick, '')), 24);
  if v_nick = '' then v_nick := 'Gracz'; end if;
  v_color := coalesce(p_color, '');
  if v_color !~ '^#[0-9a-fA-F]{6}$' then v_color := '#c8a06a'; end if;
  v_client := left(coalesce(p_client_id, ''), 64);
  if v_client = '' then
    return jsonb_build_object('ok', false, 'error', 'Brak identyfikatora klienta.');
  end if;
  v_party := nullif(upper(left(btrim(coalesce(p_party_code, '')), 8)), '');

  -- Prosty, bezstanowy limit: jedna wiadomość na 350 ms na konto.
  if exists (
    select 1 from public.rejplay_chat
    where user_id = v_user.user_id
      and created_at > now() - interval '350 milliseconds'
  ) then
    return jsonb_build_object('ok', false, 'error', 'Poczekaj chwilę przed kolejną wiadomością.');
  end if;

  insert into public.rejplay_chat (client_id, nick, color, content, party_code, user_id)
  values (v_client, v_nick, v_color, v_content, v_party, v_user.user_id)
  returning id into v_id;

  return jsonb_build_object('ok', true, 'id', v_id);
end $$;

grant execute on function public.rejplay_chat_send(text, text, text, text, text, text)
  to anon, authenticated;

-- 3. Profil: zapis tylko pod własnym kontem, bez przejmowania cudzego client_id.
create or replace function public.rejplay_profile_save(
  p_token text, p_client_id text, p_nick text, p_color text, p_appearance jsonb
)
returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  v_user record;
  v_client text;
  v_nick text;
  v_color text;
begin
  select * into v_user from public.rejplay_party_user(p_token);
  if v_user.user_id is null then
    return jsonb_build_object('ok', false, 'error', 'Sesja konta wygasła. Zaloguj się ponownie.');
  end if;
  v_client := left(coalesce(p_client_id, ''), 64);
  if v_client = '' then
    return jsonb_build_object('ok', false, 'error', 'Brak identyfikatora klienta.');
  end if;
  v_nick := left(btrim(coalesce(p_nick, '')), 24);
  if v_nick = '' then v_nick := 'Gracz'; end if;
  v_color := coalesce(p_color, '');
  if v_color !~ '^#[0-9a-fA-F]{6}$' then v_color := '#c8a06a'; end if;

  insert into public.rejplay_profiles (client_id, nick, color, appearance, user_id, updated_at)
  values (v_client, v_nick, v_color, coalesce(p_appearance, '{}'::jsonb), v_user.user_id, now())
  on conflict (client_id) do update set
    nick = excluded.nick,
    color = excluded.color,
    appearance = excluded.appearance,
    user_id = excluded.user_id,
    updated_at = now()
  where public.rejplay_profiles.user_id is null
     or public.rejplay_profiles.user_id = excluded.user_id;

  return jsonb_build_object('ok', true);
end $$;

grant execute on function public.rejplay_profile_save(text, text, text, text, jsonb)
  to anon, authenticated;

-- 4. Zdarzenia produktowe: bez tokenu nie dopisujemy szumu do bazy.
create or replace function public.rejplay_event_log(
  p_token text, p_client_id text, p_nick text, p_kind text, p_detail text
)
returns jsonb
language plpgsql security definer set search_path = public as $$
declare v_user record;
begin
  select * into v_user from public.rejplay_party_user(p_token);
  if v_user.user_id is null then
    return jsonb_build_object('ok', false, 'error', 'Sesja konta wygasła. Zaloguj się ponownie.');
  end if;
  insert into public.rejplay_events (client_id, nick, kind, detail, user_id)
  values (
    left(coalesce(p_client_id, ''), 64),
    left(coalesce(p_nick, ''), 24),
    left(coalesce(p_kind, ''), 40),
    left(coalesce(p_detail, ''), 180),
    v_user.user_id
  );
  return jsonb_build_object('ok', true);
end $$;

grant execute on function public.rejplay_event_log(text, text, text, text, text)
  to anon, authenticated;
