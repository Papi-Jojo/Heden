-- =====================================================================
-- Heden — garde-fous de taille (avant d'ouvrir l'app au public)
-- À coller dans Supabase > SQL Editor > New query, puis « Run ». Peut être relancé sans risque.
-- Les limites sont larges : un usage normal n'en approche pas (une annonce pèse ~3 Ko, une zone ~2 Ko).
-- « not valid » : les lignes déjà là ne sont pas revérifiées, seules les nouvelles écritures le sont.
-- =====================================================================
do $$
declare c record;
begin
  for c in select * from (values
    ('profiles',  'profiles_taille',  'length(display_name) <= 80 and length(criteria::text) <= 20000 and length(coalesce(home::text, '''')) <= 60000'),
    ('maps',      'maps_taille',      'length(name) <= 80 and length(criteria::text) <= 20000'),
    ('zones',     'zones_taille',     'length(name) <= 200 and length(place) <= 200 and length(points::text) <= 60000 and length(coalesce(estimates::text, '''')) <= 30000'),
    ('ratings',   'ratings_taille',   'length(comment) <= 4000 and length(ratings::text) <= 6000 and length(coalesce(moment, '''')) <= 40'),
    ('listings',  'listings_taille',  'length(url) <= 2000 and length(status) <= 20 and length(data::text) <= 120000')
  ) as t(tbl, nom, expr) loop
    if not exists (select 1 from pg_constraint where conname = c.nom) then
      execute format('alter table public.%I add constraint %I check (%s) not valid', c.tbl, c.nom, c.expr);
    end if;
  end loop;
end $$;

-- Nombre de cartes communes par personne et de membres par carte : de quoi chercher à plusieurs, pas de quoi saturer
create or replace function public.limite_cartes() returns trigger language plpgsql security definer set search_path = public as $$
begin
  if tg_table_name = 'maps' and new.kind = 'partagee' and (select count(*) from maps where owner = new.owner and kind = 'partagee') >= 20 then
    raise exception 'trop de cartes communes';
  end if;
  if tg_table_name = 'map_members' and (select count(*) from map_members where map_id = new.map_id) >= 30 then
    raise exception 'carte complète';
  end if;
  return new;
end $$;
drop trigger if exists limite_cartes on public.maps;
create trigger limite_cartes before insert on public.maps for each row execute function public.limite_cartes();
drop trigger if exists limite_membres on public.map_members;
create trigger limite_membres before insert on public.map_members for each row execute function public.limite_cartes();
