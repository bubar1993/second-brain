-- 14.10.2026 (richiesta di Giovanni): elenco Persone ordinato per uso.
-- In cima sempre Lady di Blackwood, Leonardo e Jolie (persone.in_cima); poi chi ha più note, messaggi WhatsApp
-- e appuntamenti. I figli di Lady di Blackwood stanno in un menu a tendina sotto di lei (persone.sotto_id).

alter table public.persone add column if not exists in_cima smallint;
alter table public.persone add column if not exists sotto_id uuid references public.persone(id) on delete set null;

-- Quanto "si usa" una persona: note collegate + messaggi WhatsApp + appuntamenti. Rispetta le regole di accesso.
create or replace view public.persone_uso with (security_invoker = true) as
select p.id,
  (select count(*) from public.note_persone np where np.persona_id = p.id)
  + (select count(*) from public.wa_messaggi m join public.wa_contatti c on c.wa_id = m.wa_id where c.persona_id = p.id)
  + (select count(*) from public.eventi e where e.persona_id = p.id) as uso
from public.persone p
where p.eliminata_il is null;
revoke all on public.persone_uso from anon;
grant select on public.persone_uso to authenticated;

update public.persone set in_cima = 1 where id = '117e1fa4-5778-4057-8615-263856612bae'; -- Lady di Blackwood
update public.persone set in_cima = 2 where id = 'fd924697-8bd2-4216-8a1d-834f5b919d86'; -- Leonardo
update public.persone set in_cima = 3 where id = 'f9f63fd8-d08c-42a6-93d3-843a5efb96a2'; -- Jolie

-- Davide e Celeste: Giovanni li aveva già scritti come "Davide Russo" e "Celeste Russo" (persone create dall'agente).
-- Restano quelle; le due fatte in figli_lady passano a loro e vanno nel cestino.
update public.persone set ruolo = 'figlio di Lady di Blackwood', sotto_id = '117e1fa4-5778-4057-8615-263856612bae'
  where id = '98332e54-9887-43b3-8184-f280307b9307';
update public.persone set ruolo = 'figlia di Lady di Blackwood', sotto_id = '117e1fa4-5778-4057-8615-263856612bae'
  where id = 'fa2d1c64-8863-4c34-aede-fd3d35e56e0a';
update public.quaderno_capitoli set persona_id = '98332e54-9887-43b3-8184-f280307b9307' where persona_id = 'f40c400a-0a6c-4ac9-981a-3433015cb653';
update public.quaderno_capitoli set persona_id = 'fa2d1c64-8863-4c34-aede-fd3d35e56e0a' where persona_id = 'b4a51887-3ced-407e-8485-166913f73540';
update public.attivita_figli set persone = array['98332e54-9887-43b3-8184-f280307b9307'::uuid] where persone = array['f40c400a-0a6c-4ac9-981a-3433015cb653'::uuid];
update public.attivita_figli set persone = array['fa2d1c64-8863-4c34-aede-fd3d35e56e0a'::uuid] where persone = array['b4a51887-3ced-407e-8485-166913f73540'::uuid];
update public.persone set eliminata_il = now() where id in ('f40c400a-0a6c-4ac9-981a-3433015cb653', 'b4a51887-3ced-407e-8485-166913f73540') and eliminata_il is null;
