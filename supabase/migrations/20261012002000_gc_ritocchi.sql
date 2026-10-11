-- Ritocchi fase 5 (applicati durante la messa in funzione, 11-12.10.2026).

-- L'agente non vede lo schema auth: la funzione gira coi permessi del proprietario.
create or replace function public.utente_predefinito() returns uuid
language sql stable security definer set search_path = '' as
$$ select coalesce(auth.uid(), 'f220cb9e-6628-4fd4-b2ef-f7e5f49d9a54'::uuid) $$;

-- Annullo bozze superate: un UPDATE non può usare "lateral" sulla tabella che aggiorna.
create or replace function public.annulla_bozze_superate() returns integer
language plpgsql security definer set search_path = public as $$
declare n integer;
begin
  update bozze b set stato = 'annullata', annullata_il = now(),
         motivo_annullata = case when p.cartella = 'inviata'
           then 'Qualcuno ha giÃ  risposto da info@ (' || to_char(p.data at time zone 'Europe/Zurich', 'DD.MM HH24:MI') || ')'
           else 'Ãˆ arrivata una mail nuova nella conversazione (' || to_char(p.data at time zone 'Europe/Zurich', 'DD.MM HH24:MI') || ')' end
    from (
      select distinct on (b2.id) b2.id as bozza_id, q.cartella, q.data
        from bozze b2
        join posta q on q.thread_key = b2.thread_key
                    and q.data > b2.creata_il
                    and q.message_id is distinct from b2.inviata_message_id
                    and (b2.posta_id is null or q.id <> b2.posta_id)
       where b2.stato = 'proposta' and b2.thread_key is not null
       order by b2.id, q.data) p
   where b.id = p.bozza_id;
  get diagnostics n = row_count;
  return n;
end $$;
revoke execute on function public.annulla_bozze_superate() from public, anon, authenticated;

