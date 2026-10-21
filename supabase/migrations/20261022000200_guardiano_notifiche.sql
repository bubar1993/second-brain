-- Guardiano: le notifiche dei guasti ("Guasto: …" e "Risolto: …") sono due tipi nuovi di notifica.
alter table public.notifiche_inviate drop constraint notifiche_inviate_tipo_check;
alter table public.notifiche_inviate add constraint notifiche_inviate_tipo_check
  check (tipo in ('appuntamento', 'promemoria', 'capo_risposta', 'capo_conferma', 'guasto', 'guasto_risolto'));
