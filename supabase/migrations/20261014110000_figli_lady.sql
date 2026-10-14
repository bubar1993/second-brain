-- 14.10.2026 (richiesta di Giovanni): Davide e Celeste, i figli di Lady di Blackwood (Alessia Rizzo), nel Privato.
-- Nel quaderno stanno in un menu a tendina sotto il capitolo di Lady di Blackwood (quaderno_capitoli.sotto_id).
-- Le loro attività fisse vanno in attivita_figli ma NON nel calendario Google (scelta di Giovanni);
-- la schermata Gemelli mostra solo le attività di Leonardo e Jolie.

alter table public.quaderno_capitoli add column if not exists sotto_id uuid references public.quaderno_capitoli(id) on delete set null;

do $$
declare
  lady uuid := '117e1fa4-5778-4057-8615-263856612bae';
  cap_lady uuid := (select id from public.quaderno_capitoli where persona_id = '117e1fa4-5778-4057-8615-263856612bae' and tipo = 'persona' and eliminata_il is null);
  davide uuid;
  celeste uuid;
begin
  if exists (select 1 from public.persone where ruolo like '% di Lady di Blackwood' and eliminata_il is null) then return; end if;
  insert into public.persone (nome, ruolo, fonte) values ('Davide', 'figlio di Lady di Blackwood', 'app') returning id into davide;
  insert into public.persone (nome, ruolo, fonte) values ('Celeste', 'figlia di Lady di Blackwood', 'app') returning id into celeste;
  insert into public.persone_aree (persona_id, area) values (davide, 'P'), (celeste, 'P');
  insert into public.quaderno_capitoli (tipo, persona_id, ordine, sotto_id) values ('persona', davide, 0, cap_lady), ('persona', celeste, 1, cap_lady);
  -- giorno: 1 = lunedì … 7 = domenica
  insert into public.attivita_figli (persone, nome, giorno, inizio, fine, note) values
    (array[davide], 'Pianoforte', 2, '17:00', '18:30', 'Non nel calendario (Giovanni, 14.10.2026)'),
    (array[davide], 'Basket', 1, '18:30', '20:00', 'Non nel calendario (Giovanni, 14.10.2026)'),
    (array[davide], 'Basket', 3, '18:30', '20:00', 'Non nel calendario (Giovanni, 14.10.2026)'),
    (array[celeste], 'Gymnastique', 4, '16:45', null, 'Non nel calendario (Giovanni, 14.10.2026)');
end $$;
