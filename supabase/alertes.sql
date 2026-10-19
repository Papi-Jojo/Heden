-- =====================================================================
-- Heden : réception automatique des alertes e-mail (SeLoger, PAP, Leboncoin…)
-- Un script Gmail de l'utilisateur envoie chaque alerte reçue à ingest_email(),
-- protégée par un jeton personnel. L'app lit ensuite la boîte et ajoute les annonces.
-- À lancer après annonces.sql. Relançable sans risque.
-- =====================================================================
-- Jeton personnel (lisible par son seul propriétaire)
create table if not exists public.ingest_tokens (
  user_id    uuid primary key references auth.users(id) on delete cascade,
  token      text not null unique,
  created_at timestamptz not null default now(),
  last_at    timestamptz,
  received   int not null default 0
);
alter table public.ingest_tokens enable row level security;
drop policy if exists "jeton : lecture" on public.ingest_tokens;
create policy "jeton : lecture" on public.ingest_tokens for select using (user_id = auth.uid());

-- Boîte de réception : e-mails en attente de lecture par l'app
create table if not exists public.inbox (
  id          uuid primary key default gen_random_uuid(),
  user_id     uuid not null references auth.users(id) on delete cascade,
  received_at timestamptz not null default now(),
  sender      text not null default '',
  subject     text not null default '',
  html        text not null default ''
);
create index if not exists inbox_user_idx on public.inbox(user_id, received_at);
alter table public.inbox enable row level security;
drop policy if exists "boite : lecture" on public.inbox;
create policy "boite : lecture" on public.inbox for select using (user_id = auth.uid());
drop policy if exists "boite : suppression" on public.inbox;
create policy "boite : suppression" on public.inbox for delete using (user_id = auth.uid());

-- Crée (ou renouvelle) le jeton de l'utilisateur connecté
create or replace function public.new_ingest_token() returns text
language plpgsql security definer set search_path = public as $$
declare t text := replace(gen_random_uuid()::text, '-', '') || replace(gen_random_uuid()::text, '-', '');
begin
  if auth.uid() is null then raise exception 'non connecté'; end if;
  insert into public.ingest_tokens(user_id, token) values (auth.uid(), t)
  on conflict (user_id) do update set token = excluded.token, created_at = now();
  return t;
end $$;
revoke all on function public.new_ingest_token() from public, anon;
grant execute on function public.new_ingest_token() to authenticated;

-- Point d'entrée du script Gmail (appelé avec la clé publique + le jeton)
create or replace function public.ingest_email(p_token text, p_from text, p_subject text, p_html text) returns boolean
language plpgsql security definer set search_path = public as $$
declare u uuid;
begin
  if p_token is null or length(p_token) < 32 then return false; end if;
  select user_id into u from public.ingest_tokens where token = p_token;
  if u is null then return false; end if;
  -- garde-fous : 300 e-mails par jour, 1 Mo par e-mail, 500 en attente
  if (select count(*) from public.inbox where user_id = u and received_at > now() - interval '1 day') >= 300 then return false; end if;
  if (select count(*) from public.inbox where user_id = u) >= 500 then return false; end if;
  insert into public.inbox(user_id, sender, subject, html)
  values (u, left(coalesce(p_from, ''), 300), left(coalesce(p_subject, ''), 500), left(coalesce(p_html, ''), 1000000));
  update public.ingest_tokens set last_at = now(), received = received + 1 where user_id = u;
  return true;
end $$;
revoke all on function public.ingest_email(text, text, text, text) from public;
grant execute on function public.ingest_email(text, text, text, text) to anon, authenticated;
