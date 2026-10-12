-- Bozze Ceramex nell'app (12.10.2026, ok di Giovanni).
-- Le prepara la routine "Bozze mail Ceramex" in Gmail e nel gestionale Ceramex (mail_bozze);
-- copia-ceramex le porta qui con lo stesso id. Dall'app si inviano dalla Gmail di Giovanni (funzione gmail-bozza).

alter table public.bozze drop constraint bozze_canale_check;
alter table public.bozze add constraint bozze_canale_check check (canale = any (array['mail', 'whatsapp', 'gmail']));

alter table public.bozze
  add column if not exists gmail_draft_id text,
  add column if not exists gmail_thread_id text,
  add column if not exists gmail_message_id text,   -- id Gmail del messaggio a cui risponde
  add column if not exists da_nome text,              -- chi ha scritto (o a chi va il sollecito)
  add column if not exists testo_inviato text,        -- cosa ha mandato davvero Giovanni (dal gestionale Ceramex)
  add column if not exists differenze text;

create index if not exists bozze_gmail_thread_idx on public.bozze (gmail_thread_id);
