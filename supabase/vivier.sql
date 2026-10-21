-- =====================================================================
-- Heden — le vivier : les annonces reçues par l'adresse d'alertes de Heden, communes à tous les membres.
-- La boîte d'alertes (Gmail + script, voir scripts/vivier/gmail.gs) envoie chaque e-mail à vivier_recevoir()
-- avec la clé du vivier. Les appareils des membres connectés lisent les e-mails en attente (vivier_prendre),
-- en tirent les annonces avec le même lecteur que le bouton + Heden, et les déposent (vivier_poser).
-- Chaque membre voit les annonces du vivier qui correspondent à ses critères et ajoute celles qui l'intéressent.
-- Ce qui est gardé : le lien, les chiffres, un court extrait et les liens des photos (pas de copie des images).
-- À lancer après annonces.sql et alertes.sql. Relançable sans risque.
-- =====================================================================
create table if not exists public.vivier_cles (
  cle        text primary key,
  nom        text not null default '',
  created_at timestamptz not null default now()
);
alter table public.vivier_cles enable row level security;          -- aucune règle : illisible depuis l'app

create table if not exists public.vivier_courrier (
  id          uuid primary key default gen_random_uuid(),
  received_at timestamptz not null default now(),
  sender      text not null default '',
  subject     text not null default '',
  html        text not null default '',
  pris_le     timestamptz,
  essais      int not null default 0
);
create index if not exists vivier_courrier_idx on public.vivier_courrier(received_at);
alter table public.vivier_courrier enable row level security;      -- lu seulement par vivier_prendre()

create table if not exists public.vivier (
  id         uuid primary key default gen_random_uuid(),
  url        text not null,
  source     text not null default '',
  kind       text not null default 'achat',
  postcode   text,
  price      numeric,
  surface    numeric,
  rooms      int,
  carte      jsonb not null default '{}'::jsonb,                     -- {url, text, imgs} : ce que montrait l'alerte
  prix_hist  jsonb not null default '[]'::jsonb,
  first_seen timestamptz not null default now(),
  last_seen  timestamptz not null default now(),
  gone_at    timestamptz
);
create index if not exists vivier_vu_idx on public.vivier(last_seen desc);
create index if not exists vivier_url_idx on public.vivier(url);
create index if not exists vivier_bien_idx on public.vivier(postcode, rooms);
alter table public.vivier enable row level security;
drop policy if exists "vivier : lecture" on public.vivier;
create policy "vivier : lecture" on public.vivier for select to authenticated using (true);

-- Entrée : appelée par la boîte d'alertes (clé publique Supabase + clé du vivier)
create or replace function public.vivier_recevoir(p_cle text, p_from text, p_subject text, p_html text) returns boolean
language plpgsql security definer set search_path = public as $$
begin
  if p_cle is null or not exists (select 1 from vivier_cles where cle = p_cle) then return false; end if;
  -- garde-fous : 3 000 e-mails par jour, 5 000 en attente, 1 Mo par e-mail
  if (select count(*) from vivier_courrier where received_at > now() - interval '1 day') >= 3000 then return false; end if;
  if (select count(*) from vivier_courrier) >= 5000 then return false; end if;
  insert into vivier_courrier(sender, subject, html)
  values (left(coalesce(p_from, ''), 300), left(coalesce(p_subject, ''), 500), left(coalesce(p_html, ''), 1000000));
  return true;
end $$;
revoke all on function public.vivier_recevoir(text, text, text, text) from public;
grant execute on function public.vivier_recevoir(text, text, text, text) to anon, authenticated;

-- Un appareil connecté prend quelques e-mails à lire ; s'il ne finit pas, un autre les reprend 10 minutes plus tard
create or replace function public.vivier_prendre(n int default 5) returns setof public.vivier_courrier
language plpgsql security definer set search_path = public as $$
begin
  if auth.uid() is null then raise exception 'non connecté'; end if;
  delete from vivier_courrier where essais >= 3;                    -- illisible après trois essais : abandonné
  return query
    update vivier_courrier set pris_le = now(), essais = essais + 1
    where id in (select id from vivier_courrier where pris_le is null or pris_le < now() - interval '10 minutes'
                 order by received_at limit least(greatest(n, 1), 20) for update skip locked)
    returning *;
end $$;
revoke all on function public.vivier_prendre(int) from public, anon;
grant execute on function public.vivier_prendre(int) to authenticated;

-- Il dépose ce qu'il a lu : annonce nouvelle, déjà connue (revue, prix changé) ou retirée
create or replace function public.vivier_poser(p_courrier uuid, p_annonces jsonb, p_retirees jsonb default '[]'::jsonb) returns int
language plpgsql security definer set search_path = public as $$
declare a jsonb; v uuid; n int := 0; prix numeric; surf numeric; pc text; nb int; k text; u text; recu timestamptz;
begin
  if auth.uid() is null then raise exception 'non connecté'; end if;
  select received_at into recu from vivier_courrier where id = p_courrier;
  if recu is null then return 0; end if;                              -- déjà traité par un autre appareil
  for a in select x.value from jsonb_array_elements(coalesce(p_annonces, '[]'::jsonb)) as x limit 80 loop
    u := left(coalesce(a->>'url', ''), 2000); k := case when a->>'kind' = 'location' then 'location' else 'achat' end;
    prix := nullif(a->>'price', '')::numeric; surf := nullif(a->>'surface', '')::numeric; nb := nullif(a->>'rooms', '')::int; pc := left(a->>'postcode', 5);
    if prix is null or prix <= 0 or length(u) < 8 or length(coalesce(a->'carte', '{}'::jsonb)::text) > 8000 then continue; end if;
    -- même annonce : même lien, ou même bien (code postal, pièces, surface à 1,5 m², prix à 20 %) revu dans les 60 jours
    v := null;
    select id into v from vivier
      where url = u or (pc is not null and postcode = pc and kind = k and surf is not null and abs(surface - surf) <= 1.5
                        and (nb is null or rooms is null or rooms = nb) and abs(price - prix) / greatest(price, prix) < 0.2
                        and last_seen > now() - interval '60 days')
      order by (url = u) desc, last_seen desc limit 1;
    if v is null then
      insert into vivier(url, source, kind, postcode, price, surface, rooms, carte, first_seen, last_seen)
      values (u, left(coalesce(a->>'source', ''), 60), k, pc, prix, surf, nb, coalesce(a->'carte', '{}'::jsonb), recu, recu);
    else
      update vivier set
        prix_hist = case when recu >= last_seen and price <> prix then prix_hist || jsonb_build_object('price', price, 'at', last_seen) else prix_hist end,
        price     = case when recu >= last_seen then prix else price end,      -- un e-mail plus ancien ne remet pas un vieux prix
        carte     = case when jsonb_array_length(coalesce(a->'carte'->'imgs', '[]'::jsonb)) > jsonb_array_length(coalesce(carte->'imgs', '[]'::jsonb)) then a->'carte' else carte end,
        last_seen = greatest(last_seen, recu), gone_at = null
      where id = v;
    end if;
    n := n + 1;
  end loop;
  update vivier set gone_at = recu
    where gone_at is null and url in (select left(x.value, 2000) from jsonb_array_elements_text(coalesce(p_retirees, '[]'::jsonb)) as x);
  delete from vivier_courrier where id = p_courrier;
  delete from vivier where last_seen < now() - interval '120 days';   -- plus vue depuis quatre mois : sans doute vendue
  return n;
end $$;
revoke all on function public.vivier_poser(uuid, jsonb, jsonb) from public, anon;
grant execute on function public.vivier_poser(uuid, jsonb, jsonb) to authenticated;
