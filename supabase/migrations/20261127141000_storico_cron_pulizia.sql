-- Pulizia dello storico dei lavori automatici (27.11.2026, ok di Giovanni, antagonista).
-- cron.job_run_details non si pulisce da sola: 123'000 righe dall'11.10.2026, 96 MB (un terzo del database).
-- Il guardiano guarda solo gli ultimi 30 minuti (guardiano_dati): si tengono 14 giorni.
-- La prima notte cancella circa tre quarti delle righe; lo spazio su disco resta occupato ma viene riusato.

select cron.unschedule('storico-cron-pulizia') where exists (select 1 from cron.job where jobname = 'storico-cron-pulizia');
select cron.schedule('storico-cron-pulizia', '50 3 * * *',
  $$delete from cron.job_run_details where start_time < now() - interval '14 days'$$);
-- start_time e non end_time: le righe rimaste a meta' dopo un riavvio non hanno l'ora di fine e non andrebbero mai via.
