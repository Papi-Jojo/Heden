-- =====================================================================
-- Heden : photos des zones (à lancer après schema.sql, relançable sans risque)
-- Fichiers dans le stockage privé « photos » : <user_id>/<zone_id>/<photo_id>.jpg (+ _t.jpg pour la vignette)
-- =====================================================================
create table if not exists public.zone_photos (
  id         uuid primary key default gen_random_uuid(),
  zone_id    uuid not null references public.zones(id) on delete cascade,
  user_id    uuid not null references auth.users(id) on delete cascade default auth.uid(),
  path       text not null,
  thumb      text not null,
  width      int,
  height     int,
  created_at timestamptz not null default now()
);
create index if not exists zone_photos_zone_idx on public.zone_photos(zone_id);
alter table public.zones add column if not exists cover_photo uuid;   -- photo de couverture (vignette sur la carte)

alter table public.zone_photos enable row level security;
drop policy if exists "photos : lecture" on public.zone_photos;
create policy "photos : lecture" on public.zone_photos for select
  using (exists(select 1 from public.zones z where z.id = zone_id and public.is_map_member(z.map_id)));
drop policy if exists "photos : ajout" on public.zone_photos;
create policy "photos : ajout" on public.zone_photos for insert
  with check (user_id = auth.uid() and exists(select 1 from public.zones z where z.id = zone_id and public.is_map_member(z.map_id)));
drop policy if exists "photos : suppression" on public.zone_photos;
create policy "photos : suppression" on public.zone_photos for delete using (user_id = auth.uid());

-- Stockage privé, 5 Mo par fichier, JPEG ou WebP
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('photos', 'photos', false, 5242880, array['image/jpeg', 'image/webp'])
on conflict (id) do update set public = false, file_size_limit = excluded.file_size_limit, allowed_mime_types = excluded.allowed_mime_types;

drop policy if exists "heden photos : ajout" on storage.objects;
create policy "heden photos : ajout" on storage.objects for insert to authenticated
  with check (bucket_id = 'photos' and (storage.foldername(name))[1] = auth.uid()::text);
drop policy if exists "heden photos : lecture" on storage.objects;
create policy "heden photos : lecture" on storage.objects for select to authenticated
  using (bucket_id = 'photos' and exists(
    select 1 from public.zones z where z.id::text = (storage.foldername(objects.name))[2] and public.is_map_member(z.map_id)));
drop policy if exists "heden photos : suppression" on storage.objects;
create policy "heden photos : suppression" on storage.objects for delete to authenticated
  using (bucket_id = 'photos' and (storage.foldername(name))[1] = auth.uid()::text);
