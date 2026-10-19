-- =====================================================================
-- Heden : zones jumelles (carte perso <-> carte commune) et photos partagées
-- À lancer après schema.sql et photos.sql. Relançable sans risque.
-- =====================================================================

-- Une zone de la carte perso peut être reliée à sa jumelle sur une carte commune
alter table public.zones add column if not exists link_zone uuid references public.zones(id) on delete set null;
create index if not exists zones_link_idx on public.zones(link_zone);

-- Une photo peut être rattachée à la zone jumelle (déplacée de la carte perso vers la carte commune)
drop policy if exists "photos : modification" on public.zone_photos;
create policy "photos : modification" on public.zone_photos for update
  using (user_id = auth.uid())
  with check (user_id = auth.uid() and exists(select 1 from public.zones z where z.id = zone_id and public.is_map_member(z.map_id)));

-- Lecture des fichiers : autorisée si la photo est rattachée à une zone d'une carte dont on est membre
drop policy if exists "heden photos : lecture" on storage.objects;
create policy "heden photos : lecture" on storage.objects for select to authenticated
  using (bucket_id = 'photos' and exists(
    select 1 from public.zone_photos p join public.zones z on z.id = p.zone_id
    where (p.path = objects.name or p.thumb = objects.name) and public.is_map_member(z.map_id)));
