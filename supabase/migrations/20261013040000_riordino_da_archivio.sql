-- Riordino anche da cartelle dell'archivio (13.10.2026, richiesta di Giovanni): una mail già archiviata
-- si può spostare in una sottocartella nuova (es. AMARARE/MAURUS PRIVAT). Prima solo INBOX e Sent.
alter table riordino_mail drop constraint if exists riordino_mail_cartella_da_check;
alter table riordino_mail add constraint riordino_mail_cartella_da_check check (length(btrim(cartella_da)) > 0);
