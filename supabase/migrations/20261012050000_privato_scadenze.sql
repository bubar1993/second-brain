-- Second Brain GF – Privato (fase 6), primo pezzo: scadenze svizzere che tornano ogni anno (12.10.2026 notte).
-- Un promemoria "annuale", quando Giovanni lo segna fatto, si ripresenta l'anno dopo (lo fa l'app).
-- Le date personali (passaporti, collaudo auto…) le chiede l'agente privato in "Domande per te".

alter table public.promemoria add column ricorrenza text check (ricorrenza in ('annuale'));

insert into public.promemoria (utente_id, area, testo, scade_il, ricorrenza) values
  (public.utente_predefinito(), 'P', 'Gomme invernali: prendi appuntamento per il cambio', '2026-10-15 08:00:00+02', 'annuale'),
  (public.utente_predefinito(), 'P', 'Cassa malati: confronta i premi dell''anno prossimo (disdetta entro il 30.11)', '2026-11-02 08:00:00+01', 'annuale'),
  (public.utente_predefinito(), 'P', 'Cassa malati: ultimi giorni per la disdetta (deve arrivare entro il 30.11)', '2026-11-24 08:00:00+01', 'annuale'),
  (public.utente_predefinito(), 'P', 'Vignetta autostradale dell''anno nuovo (vale dal 1.12)', '2026-12-01 08:00:00+01', 'annuale'),
  (public.utente_predefinito(), 'P', 'Dichiarazione d''imposta Ticino: scadenza 30 aprile (o chiedi la proroga)', '2027-03-15 08:00:00+01', 'annuale'),
  (public.utente_predefinito(), 'P', 'Gomme estive: prendi appuntamento per il cambio', '2027-04-06 08:00:00+02', 'annuale');

insert into public.domande (utente_id, area, agente, testo) values
  (public.utente_predefinito(), 'P', 'privato', 'Quando scadono passaporto e carta d''identità tuoi e dei gemelli? (scrivi le date, ci penso io ai promemoria)'),
  (public.utente_predefinito(), 'P', 'privato', 'Auto: quando c''è il prossimo collaudo e quando si rinnova l''assicurazione?'),
  (public.utente_predefinito(), 'P', 'privato', 'Abbonamenti da disdire per tempo (telefono, palestra, giornali, streaming…): quali sono e con che preavviso?'),
  (public.utente_predefinito(), 'P', 'privato', 'Compleanni da non dimenticare: scrivi nome e data (es. «Laura 14.03»), li metto nelle schede persona.');
