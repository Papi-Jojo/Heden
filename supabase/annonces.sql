-- =====================================================================
-- Heden : annonces immobilières et critères de logement
-- À lancer après schema.sql. Relançable sans risque.
-- =====================================================================

-- Critères de logement du profil (budget, filtres, poids)
alter table public.profiles add column if not exists home jsonb;

-- Annonces ajoutées à une carte (perso ou commune)
create table if not exists public.listings (
  id         uuid primary key default gen_random_uuid(),
  map_id     uuid not null references public.maps(id) on delete cascade,
  created_by uuid not null references auth.users(id) on delete cascade default auth.uid(),
  url        text not null default '',
  status     text not null default 'nouvelle',
  lat        double precision,
  lng        double precision,
  data       jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists listings_map_idx on public.listings(map_id);

alter table public.listings enable row level security;
drop policy if exists "annonces : lecture" on public.listings;
create policy "annonces : lecture" on public.listings for select using (public.is_map_member(map_id));
drop policy if exists "annonces : ajout" on public.listings;
create policy "annonces : ajout" on public.listings for insert
  with check (public.is_map_member(map_id) and created_by = auth.uid());
drop policy if exists "annonces : modification" on public.listings;
create policy "annonces : modification" on public.listings for update
  using (public.is_map_member(map_id)) with check (public.is_map_member(map_id));
drop policy if exists "annonces : suppression" on public.listings;
create policy "annonces : suppression" on public.listings for delete using (public.is_map_member(map_id));

-- Mise à jour en direct entre les membres d'une carte commune
do $$ begin
  if not exists (select 1 from pg_publication_tables where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'listings') then
    alter publication supabase_realtime add table public.listings;
  end if;
end $$;
