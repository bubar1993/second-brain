-- "Metti in calendario" sui promemoria di una nota (21.10.2026, Giovanni): l'app crea l'appuntamento
-- 'da_creare' (l'agente calendario lo mette in Google al giro dopo) e lo lega al promemoria.
alter table public.eventi add column promemoria_id uuid references public.promemoria(id) on delete set null;
create index eventi_promemoria_idx on public.eventi (promemoria_id) where promemoria_id is not null;

-- I due rinnovi del passaporto messi a mano da Claude il 21.10 sera.
update public.eventi set promemoria_id = 'f21dc9c5-d5d2-44d4-a873-61006f114988' where id = '62c8aa84-dc37-4be1-89f1-ef203761fff4';
update public.eventi set promemoria_id = '62810434-f690-46ba-a9c2-231744c71b7f' where id = 'ca6655d8-3928-4675-a783-39fb3e9c7068';
