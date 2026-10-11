-- La casella info@ è archiviata per cliente e cantiere (Archive/CLIENTI/<cliente>/<O0…>):
-- posta-gc legge tutte le cartelle e salva il percorso, che aiuta l'agente a trovare cliente e cantiere.
alter table public.posta add column cartella_imap text;
-- Si riparte da zero con le cartelle (INBOX e Inviata comprese): le mail già salvate si aggiornano, niente doppioni.
delete from public.posta_stato;
