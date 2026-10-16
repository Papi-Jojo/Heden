-- =====================================================================
-- Heden — schéma Supabase
-- À coller tel quel dans Supabase > SQL Editor > New query, puis « Run ».
-- Le script peut être relancé sans risque (il ne supprime aucune donnée).
-- =====================================================================

-- ---------- Profils : un par compte ----------
create table if not exists public.profiles (
  id           uuid primary key references auth.users(id) on delete cascade,
  display_name text not null default '',
  preset_id    text,
  modified     boolean not null default false,
  budget       numeric,
  criteria     jsonb not null default '[]'::jsonb,
  half_points  boolean not null default false,          -- notes au demi-point
  updated_at   timestamptz not null default now()
);

-- ---------- Cartes : une carte perso par compte, plus des cartes partagées ----------
alter table public.profiles add column if not exists half_points boolean not null default false;

create table if not exists public.maps (
  id         uuid primary key default gen_random_uuid(),
  owner      uuid not null references auth.users(id) on delete cascade,
  name       text not null default 'Ma carte',
  kind       text not null default 'perso' check (kind in ('perso', 'partagee')),
  created_at timestamptz not null default now()
);
create unique index if not exists maps_one_personal_per_owner on public.maps(owner) where kind = 'perso';

create table if not exists public.map_members (
  map_id    uuid not null references public.maps(id) on delete cascade,
  user_id   uuid not null references auth.users(id) on delete cascade,
  role      text not null default 'membre' check (role in ('proprietaire', 'membre')),
  joined_at timestamptz not null default now(),
  primary key (map_id, user_id)
);

create table if not exists public.map_invites (
  code       text primary key,
  map_id     uuid not null references public.maps(id) on delete cascade,
  created_by uuid not null references auth.users(id) on delete cascade,
  expires_at timestamptz not null default now() + interval '14 days'
);

-- ---------- Zones : la forme et le nom, communs à tous les membres de la carte ----------
create table if not exists public.zones (
  id         uuid primary key default gen_random_uuid(),
  map_id     uuid not null references public.maps(id) on delete cascade,
  created_by uuid not null references auth.users(id) on delete cascade default auth.uid(),
  name       text not null default '',
  place      text not null default '',
  points     jsonb not null,                       -- [[lat, lng], ...]
  lat        double precision,
  lng        double precision,
  area       double precision,                     -- m²
  perimeter  double precision,                     -- m
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists zones_map_idx on public.zones(map_id);
-- Estimations objectives calculées par l'appli (prix DVF, lieux OpenStreetMap)
alter table public.zones add column if not exists estimates jsonb;

-- ---------- Notes : une par personne et par zone (prépare la carte à deux) ----------
create table if not exists public.ratings (
  zone_id    uuid not null references public.zones(id) on delete cascade,
  user_id    uuid not null references auth.users(id) on delete cascade default auth.uid(),
  ratings    jsonb not null default '{}'::jsonb,  -- { critere_id: 0..5 }
  fav        boolean not null default false,
  comment    text not null default '',
  visit_date date,
  moment     text not null default '',
  price      numeric,
  updated_at timestamptz not null default now(),
  primary key (zone_id, user_id)
);

-- ---------- Réveil hebdomadaire (évite la mise en pause du projet gratuit) ----------
create table if not exists public.heartbeat (id int primary key, seen_at timestamptz not null default now());
insert into public.heartbeat(id) values (1) on conflict do nothing;

-- ---------- Fonctions utilitaires (contournent la récursion des règles d'accès) ----------
create or replace function public.is_map_member(m uuid) returns boolean
language sql security definer stable set search_path = public as $$
  select exists(select 1 from map_members where map_id = m and user_id = auth.uid());
$$;

create or replace function public.shares_a_map_with(u uuid) returns boolean
language sql security definer stable set search_path = public as $$
  select exists(
    select 1 from map_members a join map_members b on a.map_id = b.map_id
    where a.user_id = auth.uid() and b.user_id = u);
$$;

-- Crée (si besoin) et renvoie la carte perso de la personne connectée
create or replace function public.ensure_personal_map() returns uuid
language plpgsql security definer set search_path = public as $$
declare m uuid;
begin
  if auth.uid() is null then raise exception 'non connecté'; end if;
  select id into m from maps where owner = auth.uid() and kind = 'perso';
  if m is null then
    insert into maps(owner, name, kind) values (auth.uid(), 'Ma carte', 'perso') returning id into m;
    insert into map_members(map_id, user_id, role) values (m, auth.uid(), 'proprietaire');
  end if;
  insert into profiles(id) values (auth.uid()) on conflict do nothing;
  return m;
end $$;

-- Crée une carte partagée et renvoie son code d'invitation
create or replace function public.create_shared_map(map_name text) returns table(map_id uuid, code text)
language plpgsql security definer set search_path = public as $$
declare m uuid; c text;
begin
  if auth.uid() is null then raise exception 'non connecté'; end if;
  insert into maps(owner, name, kind) values (auth.uid(), coalesce(nullif(trim(map_name), ''), 'Carte partagée'), 'partagee') returning id into m;
  insert into map_members(map_id, user_id, role) values (m, auth.uid(), 'proprietaire');
  c := upper(substr(replace(gen_random_uuid()::text, '-', ''), 1, 8));
  insert into map_invites(code, map_id, created_by) values (c, m, auth.uid());
  return query select m, c;
end $$;

-- Nouveau code d'invitation pour une carte partagée dont on est membre
create or replace function public.new_invite(m uuid) returns text
language plpgsql security definer set search_path = public as $$
declare c text;
begin
  if not is_map_member(m) then raise exception 'carte introuvable'; end if;
  c := upper(substr(replace(gen_random_uuid()::text, '-', ''), 1, 8));
  insert into map_invites(code, map_id, created_by) values (c, m, auth.uid());
  return c;
end $$;

-- Rejoint une carte partagée grâce à un code
create or replace function public.join_map(invite_code text) returns uuid
language plpgsql security definer set search_path = public as $$
declare m uuid;
begin
  if auth.uid() is null then raise exception 'non connecté'; end if;
  select map_id into m from map_invites where code = upper(trim(invite_code)) and expires_at > now();
  if m is null then raise exception 'code invalide ou expiré'; end if;
  insert into map_members(map_id, user_id, role) values (m, auth.uid(), 'membre') on conflict do nothing;
  insert into profiles(id) values (auth.uid()) on conflict do nothing;
  return m;
end $$;

-- Quitter une carte partagée (la carte perso ne peut pas être quittée)
create or replace function public.leave_map(m uuid) returns void
language plpgsql security definer set search_path = public as $$
begin
  delete from map_members where map_id = m and user_id = auth.uid()
    and exists(select 1 from maps where id = m and kind = 'partagee');
  delete from maps where id = m and kind = 'partagee' and not exists(select 1 from map_members where map_id = m);
end $$;

-- ---------- Règles d'accès : chacun ne voit que ses cartes ----------
alter table public.profiles    enable row level security;
alter table public.maps        enable row level security;
alter table public.map_members enable row level security;
alter table public.map_invites enable row level security;
alter table public.zones       enable row level security;
alter table public.ratings     enable row level security;
alter table public.heartbeat   enable row level security;

drop policy if exists "profil : lecture" on public.profiles;
create policy "profil : lecture" on public.profiles for select using (id = auth.uid() or shares_a_map_with(id));
drop policy if exists "profil : création" on public.profiles;
create policy "profil : création" on public.profiles for insert with check (id = auth.uid());
drop policy if exists "profil : modification" on public.profiles;
create policy "profil : modification" on public.profiles for update using (id = auth.uid()) with check (id = auth.uid());

drop policy if exists "carte : lecture" on public.maps;
create policy "carte : lecture" on public.maps for select using (is_map_member(id));
drop policy if exists "carte : renommer" on public.maps;
create policy "carte : renommer" on public.maps for update using (owner = auth.uid()) with check (owner = auth.uid());
drop policy if exists "carte : supprimer" on public.maps;
create policy "carte : supprimer" on public.maps for delete using (owner = auth.uid() and kind = 'partagee');

drop policy if exists "membres : lecture" on public.map_members;
create policy "membres : lecture" on public.map_members for select using (is_map_member(map_id));

drop policy if exists "invitations : lecture" on public.map_invites;
create policy "invitations : lecture" on public.map_invites for select using (is_map_member(map_id));

drop policy if exists "zones : lecture" on public.zones;
create policy "zones : lecture" on public.zones for select using (is_map_member(map_id));
drop policy if exists "zones : ajout" on public.zones;
create policy "zones : ajout" on public.zones for insert with check (is_map_member(map_id) and created_by = auth.uid());
drop policy if exists "zones : modification" on public.zones;
create policy "zones : modification" on public.zones for update using (is_map_member(map_id)) with check (is_map_member(map_id));
drop policy if exists "zones : suppression" on public.zones;
create policy "zones : suppression" on public.zones for delete using (is_map_member(map_id));

drop policy if exists "notes : lecture" on public.ratings;
create policy "notes : lecture" on public.ratings for select
  using (exists(select 1 from zones z where z.id = zone_id and is_map_member(z.map_id)));
drop policy if exists "notes : ajout" on public.ratings;
create policy "notes : ajout" on public.ratings for insert
  with check (user_id = auth.uid() and exists(select 1 from zones z where z.id = zone_id and is_map_member(z.map_id)));
drop policy if exists "notes : modification" on public.ratings;
create policy "notes : modification" on public.ratings for update using (user_id = auth.uid()) with check (user_id = auth.uid());
drop policy if exists "notes : suppression" on public.ratings;
create policy "notes : suppression" on public.ratings for delete using (user_id = auth.uid());

drop policy if exists "réveil : lecture publique" on public.heartbeat;
create policy "réveil : lecture publique" on public.heartbeat for select using (true);

grant execute on function public.ensure_personal_map(), public.create_shared_map(text), public.new_invite(uuid),
  public.join_map(text), public.leave_map(uuid) to authenticated;

-- ---------- Temps réel (pour voir les notes de l'autre sur une carte partagée) ----------
do $$ begin
  begin alter publication supabase_realtime add table public.zones;   exception when duplicate_object then null; end;
  begin alter publication supabase_realtime add table public.ratings; exception when duplicate_object then null; end;
end $$;
