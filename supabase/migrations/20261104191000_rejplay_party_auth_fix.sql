-- Poprawka: community_session_user() rzuca wyjątek P0001 dla wygasłego /
-- błędnego tokenu zamiast zwrócić pusty wiersz. Bez tej warstwy RPC drużyn
-- odpowiadałyby HTTP 400 zamiast czytelnego JSON-a dla frontendu.

create or replace function public.rejplay_party_user(p_token text)
returns table (user_id uuid, username text)
language plpgsql security definer set search_path = public as $$
begin
  return query select s.user_id, s.username from public.community_session_user(p_token) s;
exception when others then
  return query select null::uuid, null::text;
end $$;

grant execute on function public.rejplay_party_user(text) to anon, authenticated;

create or replace function public.rejplay_party_state(p_token text, p_code text)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  v_user record; v_code text; v_party record; v_members jsonb;
begin
  select * into v_user from public.rejplay_party_user(p_token);
  if v_user.user_id is null then
    return jsonb_build_object('ok', false, 'error', 'Sesja konta wygasła. Zaloguj się ponownie.');
  end if;
  v_code := upper(coalesce(p_code, ''));
  perform public.rejplay_party_cleanup(v_code);
  select * into v_party from public.rejplay_parties where code = v_code;
  if not found then
    return jsonb_build_object('ok', false, 'error', 'Nie ma takiej drużyny. Sprawdź kod.');
  end if;
  select coalesce(jsonb_agg(jsonb_build_object(
      'client_id', m.client_id, 'nick', m.nick, 'color', m.color,
      'appearance', m.appearance, 'user_id', m.user_id
    ) order by m.joined_at), '[]'::jsonb)
    into v_members
  from public.rejplay_party_members m where m.code = v_code;
  return jsonb_build_object(
    'ok', true, 'code', v_code, 'name', v_party.name,
    'leader', v_party.leader_user_id, 'leader_nick', v_party.leader_nick,
    'user_id', v_user.user_id, 'username', v_user.username,
    'members', v_members
  );
end $$;

create or replace function public.rejplay_party_create(
  p_token text, p_code text, p_name text, p_client_id text,
  p_nick text, p_color text, p_appearance jsonb
)
returns jsonb language plpgsql security definer set search_path = public as $$
declare v_user record; v_code text;
begin
  select * into v_user from public.rejplay_party_user(p_token);
  if v_user.user_id is null then
    return jsonb_build_object('ok', false, 'error', 'Zaloguj się kontem rejson59.github.io, aby stworzyć drużynę.');
  end if;
  v_code := upper(regexp_replace(coalesce(p_code, ''), '[^A-Za-z0-9]', '', 'g'));
  if char_length(v_code) < 4 or char_length(v_code) > 10 then
    return jsonb_build_object('ok', false, 'error', 'Kod drużyny ma 4–10 znaków (litery i cyfry).');
  end if;
  delete from public.rejplay_parties
    where code = v_code and expires_at < now()
      and not exists (select 1 from public.rejplay_party_members m where m.code = v_code);
  insert into public.rejplay_parties (code, name, leader_user_id, leader_nick)
    values (v_code, left(coalesce(nullif(p_name, ''), 'Drużyna'), 40),
            v_user.user_id, left(coalesce(nullif(p_nick, ''), v_user.username, 'Gracz'), 24))
    on conflict (code) do nothing;
  insert into public.rejplay_party_members (code, client_id, user_id, nick, color, appearance)
    values (v_code, left(p_client_id, 80), v_user.user_id,
            left(coalesce(nullif(p_nick, ''), v_user.username, 'Gracz'), 24),
            left(coalesce(nullif(p_color, ''), '#c8a06a'), 20),
            coalesce(p_appearance, '{}'::jsonb))
    on conflict (code, client_id) do update set
      user_id = excluded.user_id, nick = excluded.nick, color = excluded.color,
      appearance = excluded.appearance, last_seen_at = now();
  return public.rejplay_party_state(p_token, v_code);
end $$;

create or replace function public.rejplay_party_join(
  p_token text, p_code text, p_client_id text,
  p_nick text, p_color text, p_appearance jsonb
)
returns jsonb language plpgsql security definer set search_path = public as $$
declare v_user record; v_code text;
begin
  select * into v_user from public.rejplay_party_user(p_token);
  if v_user.user_id is null then
    return jsonb_build_object('ok', false, 'error', 'Zaloguj się kontem rejson59.github.io, aby dołączyć.');
  end if;
  v_code := upper(regexp_replace(coalesce(p_code, ''), '[^A-Za-z0-9]', '', 'g'));
  perform public.rejplay_party_cleanup(v_code);
  if not exists (select 1 from public.rejplay_parties where code = v_code) then
    return jsonb_build_object('ok', false, 'error', 'Nie ma takiej drużyny. Sprawdź kod zaproszenia.');
  end if;
  insert into public.rejplay_party_members (code, client_id, user_id, nick, color, appearance)
    values (v_code, left(p_client_id, 80), v_user.user_id,
            left(coalesce(nullif(p_nick, ''), v_user.username, 'Gracz'), 24),
            left(coalesce(nullif(p_color, ''), '#c8a06a'), 20),
            coalesce(p_appearance, '{}'::jsonb))
    on conflict (code, client_id) do update set
      user_id = excluded.user_id, nick = excluded.nick, color = excluded.color,
      appearance = excluded.appearance, last_seen_at = now();
  return public.rejplay_party_state(p_token, v_code);
end $$;

create or replace function public.rejplay_party_heartbeat(
  p_token text, p_code text, p_client_id text,
  p_nick text, p_color text, p_appearance jsonb
)
returns jsonb language plpgsql security definer set search_path = public as $$
declare v_user record;
begin
  select * into v_user from public.rejplay_party_user(p_token);
  if v_user.user_id is null then
    return jsonb_build_object('ok', false, 'error', 'Sesja wygasła.');
  end if;
  update public.rejplay_party_members
    set last_seen_at = now(), nick = left(coalesce(nullif(p_nick, ''), nick), 24),
        color = left(coalesce(nullif(p_color, ''), color), 20),
        appearance = coalesce(p_appearance, appearance)
    where code = upper(p_code) and client_id = p_client_id and user_id = v_user.user_id;
  if not found then
    return jsonb_build_object('ok', false, 'error', 'Nie jesteś już w tej drużynie.');
  end if;
  return public.rejplay_party_state(p_token, upper(p_code));
end $$;

create or replace function public.rejplay_party_leave(p_token text, p_code text, p_client_id text)
returns jsonb language plpgsql security definer set search_path = public as $$
declare v_user record;
begin
  select * into v_user from public.rejplay_party_user(p_token);
  if v_user.user_id is null then return jsonb_build_object('ok', false); end if;
  delete from public.rejplay_party_members
    where code = upper(p_code) and client_id = p_client_id and user_id = v_user.user_id;
  delete from public.rejplay_parties p
    where p.code = upper(p_code)
      and not exists (select 1 from public.rejplay_party_members m where m.code = p.code);
  return jsonb_build_object('ok', true);
end $$;
