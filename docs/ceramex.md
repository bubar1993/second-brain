# Ceramex

Note clienti Ceramex (trasloco dal gestionale), agente Ceramex, ordini Marazzi, Da seguire e Circolari (valgono anche per G&C). Testo spostato così com'era da CLAUDE.md il 14.10.2026 (versione intera nel tag git `prima-divisione-claude-md`).

### Ceramex (fase 2)
Le note clienti traslocano dal gestionale Ceramex così come sono: 1'438 note e 75 schede, nelle tabelle `clienti`, `note_clienti`, `note_regole`, `note_mail_viste`, `note_impostazioni`. Le regole restano le stesse:
- una scheda per azienda;
- note per mandante (Marazzi, Flaviker, Profilitec, Garbelotto, Altro);
- 6 sezioni: problemi, campionature, offerte, ordini, accordi, comunicazioni;
- gruppi e filiali (Bringhen);
- casi Höhne e G&C;
- apprendimento dalle correzioni.

Nel gestionale resta solo un link.

In più:
- promemoria sui problemi fermi;
- riassunto cliente prima di una visita;
- lista unica delle promesse (fatte da Giovanni e fatte a lui);
- campionature con due stati (richiesta → spedita);
- viste per mandante e per cantiere;
- persone di contatto per azienda;
- clienti silenziosi da più di 3 mesi;
- circolari dei mandanti;
- riassunto settimanale per mandante.

Offerte, solleciti e allegati PDF restano nei gestionali.

### Fase 2 (dalla lista delle fasi)

2. Trasloco note Ceramex ← IN CORSO. Backup su Google Drive FATTO (11.10.2026): funzione `backup` ogni domenica notte → Drive giovannifabris@ceramex.ch, cartella BRAIN/Backup (dati e struttura tenuti 90 giorni, foto nuove in Foto/). Collegamento Google: client OAuth "Second Brain backup" nel progetto Google Cloud "Ceramex Gestionale". Esito in `backup_registro`; se fallisce l'app lo dice in Oggi. Tappa 1 FATTA (11.10.2026): copiate 75 schede (`aziende`, contatti dentro la scheda), 1'438 note (`note` con azienda_id, mandante, sezione…), 8 regole (`regole_agenti`), mail viste (`mail_viste`); stessi id del gestionale, quindi la copia si può rifare senza doppioni. Nell'app: Dentro → Aziende (fatta come nell'app Ceramex: mandanti, sezioni, filiali, vista per sezione o per data; per ora solo lettura). Fino allo switch le note clienti si correggono nel gestionale Ceramex. Tappa 2 FATTA (11.10.2026): copia automatica ogni 10 minuti. Le routine "Bozze mail" restano invariate e scrivono in Ceramex; la funzione `copia-ceramex` (pg_cron, token `copia_token` nel Vault, segreti `CERAMEX_DB_URL` e `COPIA_TOKEN`) legge Ceramex con `brain_lettore` e copia schede, note, regole e mail viste (stessi id); le note sparite da Ceramex vanno nel cestino. Esito in `copia_registro`; Oggi avvisa se fallisce o è ferma da più di un'ora. Password e token si rifanno con `node scripts/collega-ceramex.mjs` (poi va reimpostato l'hash in Ceramex). Tappa 3 FATTA il 12.10.2026 sera: l'agente Ceramex scrive le note direttamente nel second brain (vedi "Bozze Ceramex nell'app e agente Ceramex nel second brain"); da decidere con Giovanni quando cancellare le vecchie note dal gestionale. Parcheggiato: link "dalla mail" verso Spark. La chiave segreta Ceramex in `Documenti\ceramex\reader\.env.example` resta com'è (decisione di Giovanni, non riproporla).

### Trasloco note Ceramex: chiusura (13.10.2026, ok di Giovanni passo per passo)
Piano in 5 passi: 1 controllo, 2 stacco, 3 backup su Drive, 4 link al brain nell'app Ceramex al posto delle note, 5 cancellazione nel gestionale (dopo ~1 settimana, due conferme di Giovanni). Nessun altro usa le note nell'app Ceramex.
- **Passo 1 FATTO (13.10):** gestionale 1'450 note = brain (1'302 area C `da_ceramex` identiche per id/testo/sezione/mandante/data/risolto/scartata + 148 della scheda "G&C", tutte in area G). Regole (10) e mail viste (65) tutte nel brain. Ultima nota scritta nel gestionale: 12.10 16:06.
- **Passo 2 FATTO (13.10):** `copia-ceramex` copia solo schede clienti e bozze; niente più note/regole/mail viste e niente cestino delle note sparite (così cancellarle nel gestionale non tocca il brain). Note `da_ceramex` sbloccate nell'app (`Nota.jsx`); `da_ceramex` resta solo come segno d'origine (gli agenti continuano a non riscriverle). Regola del Capo aggiornata (md + routine).
- **Passo 3 FATTO (13.10):** in Drive BRAIN/Backup `ceramex-note-2026-10-13.json.gz` (clienti, note_clienti 1'450, note_regole, note_mail_viste: tutto) e `ceramex-note-2026-10-13.csv` (da aprire in Fogli). Fatti dalla funzione `backup` con `{ "ceramex_note": true }`; il nome non inizia con "brain-", quindi la pulizia dei 90 giorni non li cancella. `note_impostazioni` non è nel backup (brain_lettore non la legge).
- **Passo 4 FATTO (13.10):** app Ceramex (commit c579764 su `bubar1993/ceramex-app`, pubblicata da sola col push): "Note clienti" in Oggi apre il Second Brain, `/note` e `/note/:id` hanno solo "Apri nel Second Brain" (`#/aziende`, `#/azienda/<id>`, stesso id). Tolti `src/lib/note.ts` e le schermate vecchie.
- Prossimo: passo 5 (cancellare le note nel gestionale, non prima del ~20.10, due conferme di Giovanni).

### Note Ceramex scritte dall'agente nel second brain (dal 12.10.2026 sera)

- **Tappa 3 (note):** dal 12.10.2026 le note clienti Ceramex le scrive l'agente direttamente nel second brain (note area C, fonte 'mail', da_ceramex false; mail_viste; regole_agenti area C agente 'note'), con l'utente DB `agente_ceramex` (solo area C + aggiungere note nel parcheggio G&C; token AGENTE_TOKEN_CERAMEX, `node scripts/collega-agente.mjs ceramex`). Nel gestionale Ceramex non si scrivono più note. Le vecchie note Ceramex restano là finché Giovanni non decide di cancellarle (non prima).
- `copia-ceramex` ora copia anche `mail_bozze` → `bozze` (area C, canale 'gmail', stesso id; brain_lettore legge mail_bozze e mail_contatti(email, nome), ok di Giovanni) e copia schede e regole SOLO se cambiate nel gestionale (per non ricoprire quello che scrive l'agente qui).

- `copia-ceramex` dal 13.10.2026 non copia più note, regole e mail viste e non mette più niente nel cestino (vedi "Trasloco note Ceramex").

- Collegamento Gmail: client OAuth "Second Brain Gmail" (App desktop, progetto Google "Ceramex Gestionale", pubblico Interno), segreti GMAIL_CLIENT_ID/SECRET/REFRESH_TOKEN, permessi gmail.compose + gmail.readonly. Si rifà con `node scripts/collega-gmail.mjs <client_secret.json>` (serve il clic di Giovanni). Il vecchio file `client_secret_503995…json` nei Download è di un altro client e contiene chiavi aggiunte in fondo: non usarlo.

### Ordini Marazzi (12.10.2026 sera, ok di Giovanni)
- Funzione `ordini-marazzi` (pg_cron ogni 15 minuti, token copia_token): cerca nella Gmail (gmail.readonly) le conferme d'ordine automatiche Marazzi degli ultimi 3 giorni (oggetto con numero 2026…, in IT/EN/DE/FR, niente inoltri), scarica il PDF ("Order Confirm Report", sempre in inglese) e ne salva il testo in `ordini_marazzi` (stato 'da_leggere'). Registro `lavori_registro` 'ordini-marazzi' solo se trova qualcosa o sbaglia.
- Routine "Ordini Marazzi" `trig_01MZAj5mn8whEhDXom22181Y` (Sonnet, :20 ogni ora 7–22, utente agente_ceramex, regole `agenti/agente-ordini.md`): capisce cliente (filiali Bringhen dal luogo di consegna; info@homeconcepts.ch = G&C → parcheggio G), righe e disponibilità ("SCHEDULED: AVAILABLE"), scrive la nota nella scheda (sezione ordini, mandante Marazzi) e riempie la riga.
- App: Dentro → "Ordini Marazzi" (solo Ceramex, `src/Ordini.jsx`): conferme degli ultimi 2 giorni con cliente, articoli, m2 e disponibilità; le più vecchie restano solo nella scheda del cliente. Tasto **Cerca** (13.10): in tutti gli ordini per cliente/rif./numero, articolo (nome, codice, formato), m² da–a (riga dell'articolo cercato, altrimenti totale ordine), disponibilità, periodo. Le liste di carico restano com'erano (decisione di Giovanni). Solo Marazzi per ora.

### Da seguire, Circolari, doppioni (13.10.2026 notte, ok di Giovanni; Ceramex e G&C)
- Routine "Agente da seguire" `trig_01DznF5caV1wjdxjt2bH1w2a` (:40 ogni 2 ore 7–21, Sonnet, SOLO connettore Gmail in lettura), regole `agenti/agente-seguire.md`, utente DB `agente_seguire` (token AGENTE_TOKEN_SEGUIRE; C+G, niente cancellazioni). Pulsante "Fallo adesso": ROUTINE_TOKEN_SEGUIRE salvato il 13.10.2026 (si rifà con `node scripts/salva-pulsante.mjs seguire`).
- Tabelle: `promesse` (chi 'io'|'altri', entro, fatta_il, chiusa_da), `campioni` (da_spedire → in_viaggio → arrivato), `circolari` (mail dei mandanti / fornitori che non riguardano un cliente; "Ricordamelo" crea il promemoria), `note_seguite` (note già guardate: NON si usa un campo di note perché cambierebbe modificata_il), `doppie` (proposte di schede/note doppie). `note.rivisto_il` = "ci sto lavorando" su un problema.
- L'agente legge solo i fatti degli ultimi 30 giorni (note.data: le note copiate dal gestionale Ceramex hanno tutte creata_il 11.10.2026).
- App: Dentro → "Da seguire" (`src/Seguire.jsx`: promesse mie / degli altri, campioni, problemi fermi = problemi aperti della stessa ditta+mandante senza novità da 7 giorni, calcolati dall'app) e "Circolari" (`src/Circolari.jsx`, per mandante/fornitore). Oggi: "N cose da seguire" (promesse scadute + problemi fermi).
- Doppioni (una volta alla settimana): l'agente chiede in "Domande per te"; col sì unisce. Schede: `aziende.unito_in` + note, persone, eventi, ordini, posta spostati; `copia-ceramex` e `copia-gc` rispettano le schede unite (mappano azienda_id). Note: una nota unita nuova, le vecchie nel cestino (imparata = true, così l'agente Ceramex non impara regole sbagliate).
- Niente "clienti silenziosi", niente riassunto settimanale per mandante, niente vista per cantiere in Ceramex (decisioni di Giovanni).

- Circolari aumenti prezzi in info@ (13.10.2026 notte, richiesta di Giovanni): messe a mano Marazzi/Ragno (Silvia Leoni, dal 1.12), Savoia (dal 2.11), ABK contributo energetico (dal 1.11), Gambini energy surcharge. Polis: nessuna mail di aumenti trovata in info@. L'agente ora riconosce il fornitore anche dal dominio del mittente (`fornitori.domini`), non solo da `posta.fornitore_id`: regola cambiata in `agenti/agente-seguire.md`; routine "Agente da seguire" aggiornata il 13.10.2026 sera.

### Note dei mandanti (30.10.2026, ok di Giovanni, piano controllato dall'antagonista)
- Nel Quaderno Ceramex c'è la sezione "Mandanti" (vedi `schermate.md`).
- Agente Ceramex, punto 4b del PASSO 5 (md + le 3 routine "Bozze mail Ceramex", aggiornate e confrontate IDENTICO il 30.10): le mail solo tra Giovanni e un mandante, senza cliente, diventano note con `azienda_id` null e `mandante` = il mandante. Le mail a tutti gli agenti, listini, aumenti, fiere e ferie restano circolari (agente "da seguire"); provvigioni fuori.
- Recupero 29.07–30.10.2026 fatto da Claude in chat (6 aiutanti in sola lettura sulla Gmail, poi controllo doppioni): 29 note (Marazzi 20, Flaviker 6, Profilitec 3, Garbelotto 0) e 24 circolari di agosto–settembre (messe già "lette", per non far salire il numero). La ricerca Gmail si ferma a 50 risultati per volta: la copertura non è totale, soprattutto Flaviker.

### Fatture in arrivo: prova del prefiltro (05.11.2026, ok di Giovanni, piano controllato due volte dall'antagonista)
- Idea di Giovanni: le fatture ricevute su Gmail Ceramex diventano schede nell'app Ceramex con i tasti Costo Ceramex (Gmail `INBOX/2025/Ricevute`, PDF su Drive per trimestre della data fattura), Costo G&C (inoltro a info@), Costo privato (mail in `INBOX/2025/Altro`, salvo sua indicazione), Non è una fattura. Il PDF entra solo dopo il tocco. Conferme d'ordine e simili non devono comparire.
- Per ora c'è solo la prova a secco: PASSO 7 della routine "Bozze mail Ceramex" ore piene (non nelle altre due). Giudica le mail dal 29.10 e scrive `fatture_in_arrivo` nel gestionale Ceramex: esito 'fattura' con mittente, oggetto e motivo; esito 'no' solo con id e data. L'app non la legge, nessuna mail viene toccata. Tabella fuori dal backup di proposito (`TABELLE` in `worker/backup.ts`): può contenere oggetti di mail private. Contatori `fatture_si`, `fatture_no`, `fatture_errori` in `lavori_registro`.
- Dopo 1-2 settimane Claude porta a Giovanni l'elenco: schede inutili e fatture perse. Prima dei tasti, tappe da approvare una alla volta: protezioni di lettore e contabilità (colonna di origine, niente conferme e abbinamenti automatici, `carte_personali`, Read limitato alla cartella temporanea), caso delle fatture non pagate (oggi una fattura `banca` confermata non si abbina, es. G&A Motors del 06.10), inoltro G&C con regola nuova in Archiviazione, Swisscom (PDF da attivare in My Swisscom) e arretrati.

Vedi anche: `agenti-routine.md` (routine "Bozze mail Ceramex", liste di carico, Riepilogo), `schermate.md` (Bozze, Riordino casella), `capo.md` (mail private dalla Gmail).

## Portafogli Crea Ceram del martedì (10.11.2026, ok di Giovanni)
- Ogni martedì Sara Pinton (Marazzi) manda a Giovanni "portafogli Crea Ceram" con 2 PDF `XXSC_MRZ_ORD05_PO_CLIENTE_<n>_1.PDF`; lui li gira in UNA mail (solo "Cordiali saluti" + firma) a 26 persone del gruppo Bringhen/Saneo/Sanimat/Santag/Sanval/Crea Ceram, nella conversazione "Portafoglio Ordini Ragno".
- Funzione `portafogli` (senza AI, solo `x-copia-token`; cron `portafogli-crea` il martedì ogni 15 minuti, 6-17 UTC): quando la mail di Sara c'è, prepara la **bozza** in Gmail con i PDF e la mette in Bozze (`bozze` area C, canale gmail, `perche.tipo = 'portafogli_crea'`, `imparata = true`). **Non invia niente**: la manda Giovanni con due tocchi. `{ "prova": true }` (anche con `data`) dice cosa farebbe senza creare niente.
- Regole: mittente verificato (DKIM marazzigroup.com, se no errore e niente bozza); solo i PDF col nome atteso (il "file Polonia" resta fuori, deciso da Giovanni); destinatari dalla lista fissa `liste_invio` chiave `portafogli_crea` (solo service_role), mai da una mail arrivata; se Giovanni nel SUO ultimo invio cambia i destinatari, la lista lo segue e la bozza lo dice; se li ha già mandati lui dopo la mail di Sara, niente bozza; una sola per settimana (indice unico); sopra i 95 messaggi apre una conversazione nuova; le bozze sparite da Gmail o vecchie di 7 giorni si annullano da sole. Gli errori escono come 502 ("Portafogli Crea Ceram: …") e li vede il guardiano.
- `gmail-bozza`: per queste bozze "Approva e invia" manda la bozza Gmail così com'è (non la riscrive, se no perderebbe i PDF); se cambiata → "aprila in Gmail". La mail originale mostrata è quella di Sara; una risposta di un cliente nella conversazione non annulla la bozza.
- La routine Ceramex salta la mail di Sara (risponde solo se Sara fa una domanda vera).
- Prova a secco del 10.11: mail di Sara trovata e verificata, 2 PDF, 26 destinatari, stesso thread. **Prima bozza vera: martedì 17.11.** Invio automatico: NON fatto; solo dopo la prova e un nuovo ok di Giovanni (servono: mittente verificato, 2 PDF veri, lista uguale, una volta a settimana, niente domande di Sara).
- Se un cliente chiede di cambiare indirizzo: Giovanni lo cambia nella bozza in Gmail (o lo dice a Claude); dal suo invio la lista si aggiorna da sola. Non si prende mai l'indirizzo dal testo di una mail arrivata.
- Niente avviso nuovo se Sara non manda: resta il promemoria "Portafoglio creaceram" del calendario (scelta di Giovanni).

## Motivo dello scarto e "non vista" (10.11.2026)
- `agente_ceramex` legge (sola lettura, poche colonne, solo area C canale gmail) le bozze del Brain: PASSO 1, regola COSA-HA-FATTO-GIOVANNI. Scartata nell'app = vale il motivo, anche se poi lui scrive a mano; inviata dall'app = correzione solo se il testo è cambiato; risposta da Gmail senza usare la bozza = "non vista", si impara lo stile ma non è una correzione.
- `copia-ceramex` non riscrive più una bozza 'scartata' nel Brain.
- Routine (10.11.2026): le 3 "Bozze mail Ceramex" (ore piene, mezz'ora, weekend) hanno il PASSO 1 nuovo e la riga PORTAFOGLI CREA CERAM nel PASSO 2 (aggiornate con RemoteTrigger dalla sessione principale, confronto IDENTICO). Per l'agente G&C la regola del motivo NON è nel prompt della routine ma in `regole_agenti` (area G, agente 'bozze', tipo 'come_rispondere', comincia con "REGOLA DI GIOVANNI DEL 10.11.2026"): le regole di quella tabella valgono più del prompt. Alla prossima modifica del prompt G&C copiarla anche lì (testo in `agenti/agente-gc.md`).
