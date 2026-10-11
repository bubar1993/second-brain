-- Second Brain GF – note copiate dal gestionale Ceramex (ok di Giovanni, 12.10.2026).
-- La copia automatica mette nel cestino le note sparite da Ceramex: da oggi tocca SOLO quelle
-- arrivate da Ceramex, così le note scritte o dettate nell'app restano anche dentro le schede Ceramex.
alter table public.note add column da_ceramex boolean not null default false;
update public.note set da_ceramex = true where area = 'C' and azienda_id is not null;
