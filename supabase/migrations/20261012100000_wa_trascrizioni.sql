-- Note vocali WhatsApp trascritte sul PC di Giovanni (Whisper sulla scheda video, gratis).
-- La trascrizione va in testo (così app e agenti la leggono come un messaggio scritto).
-- trascrizione: null = da fare | 'fatta' | 'errore: ...'
alter table public.wa_messaggi add column if not exists trascrizione text;
create index if not exists wa_messaggi_da_trascrivere on public.wa_messaggi (data)
  where tipo = 'audio' and trascrizione is null;
