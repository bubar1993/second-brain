-- Ritocchi fase 5 (applicati durante la messa in funzione, 11-12.10.2026).

-- L'agente non vede lo schema auth: la funzione gira coi permessi del proprietario.
create or replace function public.utente_predefinito() returns uuid
language sql stable security definer set search_path = '' as
$$ select coalesce(auth.uid(), 'f220cb9e-6628-4fd4-b2ef-f7e5f49d9a54'::uuid) $$;
