-- Promemoria che tornano ogni 3 mesi (13.10.2026, ok di Giovanni): quando li segna fatti, l'app li rimette 3 mesi dopo.
-- Ultimi promemoria spostati da claude.ai nell'app (le vecchie routine "Promemoria estratti PostFinance CHF"
-- e "Provvigioni Profilitec Q3" si spengono).

alter table public.promemoria drop constraint if exists promemoria_ricorrenza_check;
alter table public.promemoria add constraint promemoria_ricorrenza_check check (ricorrenza in ('annuale', 'trimestrale'));

insert into public.promemoria (utente_id, area, testo, scade_il, ricorrenza) values
  (public.utente_predefinito(), 'C', 'PostFinance: scarica gli estratti del conto CHF (…9460 1) di aprile 2021 – agosto 2023 e ottobre – dicembre 2023, mettili in uno zip e dalli a Claude per caricare lo storico 2021–2024', '2026-10-14 09:00:00+02', null),
  (public.utente_predefinito(), 'C', 'Profilitec: scarica dal portale il conteggio provvigioni del trimestre e fai la fattura', '2026-11-01 08:00:00+01', 'trimestrale');
