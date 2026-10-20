-- =====================================================================
-- Heden — cartes de groupe : critères communs
-- À coller dans Supabase > SQL Editor > New query, puis « Run ». Peut être relancé sans risque.
-- =====================================================================

-- Les critères communs d'une carte de groupe : [{id, name, desc, weight}, ...]
alter table public.maps add column if not exists criteria jsonb not null default '[]'::jsonb;

-- Tout membre de la carte peut les modifier (pas seulement la personne qui l'a créée)
create or replace function public.set_map_criteria(m uuid, c jsonb) returns void
language plpgsql security definer set search_path = public as $$
begin
  if not is_map_member(m) then raise exception 'carte inaccessible'; end if;
  if jsonb_typeof(c) <> 'array' or jsonb_array_length(c) > 24 or length(c::text) > 20000 then
    raise exception 'critères invalides';
  end if;
  update maps set criteria = c where id = m and kind = 'partagee';
end;
$$;
revoke all on function public.set_map_criteria(uuid, jsonb) from public;
grant execute on function public.set_map_criteria(uuid, jsonb) to authenticated;
