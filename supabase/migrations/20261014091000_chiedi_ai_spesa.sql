-- Quanto si è speso con l'API da una certa data (per i tetti di chiedi-ai). PostgREST non somma da solo.
create or replace function public.ai_spesa(da timestamptz) returns numeric
language sql stable set search_path = public as $$
  select coalesce(sum(costo), 0) from public.ai_uso where quando >= da
$$;
revoke execute on function public.ai_spesa(timestamptz) from public, anon;
grant execute on function public.ai_spesa(timestamptz) to authenticated, service_role;
