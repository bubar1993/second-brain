# Second Brain GF

Questo file è per Claude Code. Spiega il progetto e le regole di lavoro. Ultimo aggiornamento: 11.10.2026 sera.

## Chi è Giovanni e come rispondergli
- Giovanni Fabris, Manno (Ticino). Ha due società: **Ceramex SAGL** (agente di commercio: Marazzi/Ragno, Flaviker/ABK, Garbelotto, Profilitec) e **G&C Home Concepts Sagl** (forniture per interni).
- Non è uno sviluppatore. Lavora spesso dal telefono Android.
- Rispondi sempre in italiano, con frasi corte e concrete.
- Quando deve fare qualcosa lui: passi numerati, uno alla volta, dicendo dove cliccare. Chiudi con "Da fare per Giovanni".
- Fai tu direttamente invece di passargli codice. Dopo ogni modifica, riassumi in una riga cosa hai cambiato.

## Regole di lavoro
- Si lavora per fasi. Nessuna fase parte senza l'ok di Giovanni.
- Prima di toccare cose già funzionanti o configurazioni importanti: spiega e chiedi conferma.
- Soluzioni gratuite. Servizi a pagamento solo con il suo sì.
- Niente email o notifiche di test verso di lui.
- Una sola versione per file: aggiorna, non creare copie.
- Se divaga, fermalo e parcheggia l'idea.
- **Regola d'oro dell'app:** facile e pratica, la usa tutto il giorno. 3 tasti (Oggi, Aggiungi, Chiedi), niente moduli, una funzione nuova alla volta.

## ATTENZIONE: cose da non rompere
- Il connettore Supabase di claude.ai vede solo l'organizzazione "G&C Home Concepts & Ceramex". **Non va spostato.** Le attività programmate "Bozze mail Ceramex" (ore piene, mezz'ora, weekend) lo usano sul progetto Ceramex: se cambia, smettono di funzionare.
- Gestionale Ceramex: progetto Supabase `nouxqowregwnyqlrvqqo`, cartella `Documenti\ceramex`. Il codice dell'app Ceramex non è sul PC (solo l'app pubblicata e il repo GitHub `bubar1993/ceramex-app`). Nel gestionale c'è l'utente di sola lettura `brain_lettore` (creato l'11.10.2026 con l'ok di Giovanni): legge solo `clienti`, `note_clienti`, `note_regole`, `note_mail_viste` per la copia automatica. Non dargli altri permessi.
- Gestionale G&C: progetto Supabase `hnpesqsteytwfgrsrygn`, cartella `Documenti\gchomeconcepts`.
- I gestionali si **leggono** soltanto. Non si modificano senza l'ok di Giovanni.
- Sul PC girano programmi che non vanno toccati: il lettore mail e il portale Marazzi (`lettore.mjs`, `portale.mjs` del gestionale Ceramex).
- Lexy (vecchio assistente su Telegram) non si usa più. Non va ripresa.

## Accesso alla nuova organizzazione Supabase
- Organizzazione nuova: **"Second Brain GF"**, piano Pro. Progetto **second-brain** (`vgurncqvgulldolhetyr`, Zurigo), creato l'11.10.2026.
- App pubblicata come Worker Cloudflare `second-brain`: https://second-brain.aged-king-4bbd.workers.dev (pubblicare con `npm run deploy`). L'accesso con impronta è legato a questo indirizzo: se cambia, Giovanni deve registrare di nuovo l'impronta.
- Accesso tramite **token personale di Supabase** (supabase.com → Account → Access Tokens), che vede tutte le organizzazioni.
- Il token si salva solo come variabile d'ambiente di Windows (`SUPABASE_ACCESS_TOKEN`) o con `supabase login`. **Mai** nella chat, mai in file del progetto, mai su git.
- Per Cloudflare si usa lo stesso metodo delle altre due app (guarda come sono pubblicate in `Documenti\ceramex` e `Documenti\gchomeconcepts`).

## Il progetto
Una sola app (PWA installabile su Android, come le altre due) dove Giovanni tiene tutto quello che deve ricordare. Ci sono tre aree: **Ceramex (C)**, **G&C (G)**, **Privato (P)**, ognuna con un colore fisso.

### Architettura
| Parte | Dove | Cosa fa |
| --- | --- | --- |
| Second brain | Supabase Pro, org "Second Brain GF", regione eu-central-2 (Zurigo) | Note, persone, promemoria, liste, regole degli agenti |
| Gestionale Ceramex | Supabase gratuito, non si tocca | Contabilità, fatture, bozze mail. Le note clienti traslocano qui (fase 2) |
| Gestionale G&C | Supabase gratuito, non si tocca | Clienti, cantieri, documenti, fornitori. Passa nomi clienti e cantieri |
| Calendario | Google Calendar di Giovanni | Un calendario Google per area (C, G, P), ognuno col suo colore |
| App | Cloudflare, come le altre due | Interfaccia unica |

Per leggere i gestionali dal second brain si usa una chiave di sola lettura per ognuno, salvata come segreto nel progetto nuovo (fase 2).

Intelligenza artificiale (dettagli da decidere prima della fase 4):
- Haiku per le domande semplici nell'app.
- Sonnet per il tasto "Domanda difficile" (stima 5–15 CHF/mese).
- Ragionamenti lunghi: app Claude, coperta dal piano Max.

### Struttura dell'app
- **Stile (scelto da Giovanni l'11.10.2026): "rete neurale".** Fondo spaziale scuro, vetro, Instrument Serif corsivo per i titoli e Geist per il testo, aree in tinte chiare (C #5b93ff, G #34d58a, P #ff8f45). In Oggi c'è la rete 3D animata (`src/Rete.jsx`): promemoria = neuroni, poi note e clienti recenti; si gira col dito e si ferma quando non si vede. Le altre schermate solo vestite; gli effetti speciali si aggiungono uno alla volta. Brief e bozze Superdesign in `.superdesign/`.
- **Sul PC** (schermo da 1024 px in su): menu a sinistra al posto dei 3 tasti, Oggi su due colonne, Aziende divise (elenco a sinistra, scheda a destra). Sul telefono non cambia niente.
- **Chiedi** trova i clienti mentre scrivi (nome, ragione sociale, email, persone).
- **Agenti di sola lettura** in `.claude/agents/`: `gestionale-ceramex` e `gestionale-gc`, da usare quando serve guardare i gestionali.
- Interruttore in alto: un'area sola oppure tutte.
- **Persone come diagramma a cerchi:** chi sta in più aree sta nell'intersezione. Ogni nota resta però nella sua area: le cose private non finiscono mai nella scheda cliente, anche se la persona è un cliente.
- **Inbox:** il cassetto per le cose buttate dentro di corsa. Le smista l'agente oppure Giovanni.
- **Cestino:** tiene le note 30 giorni.
- Schermate:
  1. **Oggi:** appuntamenti, promemoria, problemi aperti, scadenze; riassunto del mattino e della sera.
  2. **Aggiungi:** scrivi, parla o foto; "Condividi" da altre app.
  3. **Chiedi:** domande scritte o a voce, con il link alla fonte.
  4. Dentro: schede aziende e persone, liste, "Domande per Giovanni".

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

### G&C (fase 5)
Note fatte come quelle Ceramex. Al posto dei mandanti ci sono i fornitori di tipo "principale" del gestionale G&C (`price_list_suppliers.kind = 'principale'`). Clienti presi da `clients`, cantieri da `sites`. Le 6 sezioni sono le stesse di Ceramex. L'agente legge la casella mail G&C. Si recupera lo storico mail 2026. I collaboratori vedono il gestionale G&C, ma non il second brain.

### Privato (fase 6)
| Gruppo | Contenuto |
| --- | --- |
| Persone | Compleanni e anniversari con avviso; idee regalo; scheda persona; "cose da chiedere a…"; bozza di auguri (la manda Giovanni) |
| Gemelli (8 anni) | Attività, orari, chi accompagna; compleanni dei compagni (invito → risposta → regalo); diario; visite mediche e vaccinazioni come date |
| Scadenze svizzere | Cassa malati (avviso inizio novembre, disdetta entro il 30.11); dichiarazione d'imposta; auto (collaudo, gomme ottobre/aprile, vignetta, assicurazione); passaporti e ID; abbonamenti con data di disdetta |
| Calendario famiglia | Vacanze scolastiche e giorni liberi del Ticino |
| Inviti e spese | Inviti da rispondere; spese condivise (chi deve cosa) |
| Casa e vita | Garanzie e scontrini con foto; ristoranti/posti/vacanze con voto; ricordi e note di viaggio; diario vocale della sera; obiettivi e abitudini; wishlist |
| Liste | Spesa, film, libri, ristoranti consigliati; cose prestate |

### Calendario e promemoria (fase 3)
- All'inizio gli eventi si creano solo con la conferma di Giovanni. Più avanti anche in automatico.
- Le date trovate in mail e WhatsApp vengono proposte con un tocco.
- Prima di un appuntamento con un cliente: il suo riassunto. Dopo: "cosa vuoi annotare?".
- I promemoria stanno nell'app. Le notifiche sul telefono solo per le cose urgenti che sceglie Giovanni.
- Riassunti: mattino, sera, domenica sera.

### WhatsApp e chiamate (fase 7)
- Solo il canale ufficiale WhatsApp Business: un numero unico per lavoro e privato.
- L'agente capisce chi scrive e di cosa: lavoro → scheda cliente; privato → area Privato.
- Note vocali: trascritte, e si salva solo l'essenziale.
- Chiamate: Giovanni detta un riassunto vocale a fine chiamata. **Niente registrazioni senza consenso** (in Svizzera è reato).

### Chiedi (fase 4)
- Cerca ovunque: note, mail, WhatsApp, calendario, Drive, gestionali.
- Funziona su più aree insieme e cerca per significato.
- Ogni risposta ha il link alla fonte.

### Agenti
- Regole separate per area. Giovanni le rivede parlando con Claude, non in una pagina dell'app.
- I dubbi degli agenti vanno in "Domande per Giovanni".
- C'è un registro di cosa ha fatto ogni agente.
- Controllo settimanale delle schede doppie.
- La divisione finale degli agenti si decide alla fine.

### Sicurezza
- L'app la usa solo Giovanni. Si apre con volto o impronta (passkey), senza PIN separato.
- Backup settimanale su Google Drive.
- Gli agenti di lavoro non leggono il Privato. Eccezione: impegni privati che si sovrappongono al lavoro.
- Uso senza rete e modalità scura: da valutare.

## Fasi
1. **Base** — FATTA (11.10.2026): progetto Supabase, app installabile, 3 tasti, tre aree, Inbox, Persone, accesso con volto/impronta. Il backup su Drive è stato spostato a inizio fase 2 (decisione di Giovanni): finora bastano i backup giornalieri di Supabase Pro (7 giorni, senza foto).
2. Trasloco note Ceramex ← IN CORSO. Backup su Google Drive FATTO (11.10.2026): funzione `backup` ogni domenica notte → Drive giovannifabris@ceramex.ch, cartella BRAIN/Backup (dati e struttura tenuti 90 giorni, foto nuove in Foto/). Collegamento Google: client OAuth "Second Brain backup" nel progetto Google Cloud "Ceramex Gestionale". Esito in `backup_registro`; se fallisce l'app lo dice in Oggi. Tappa 1 FATTA (11.10.2026): copiate 75 schede (`aziende`, contatti dentro la scheda), 1'438 note (`note` con azienda_id, mandante, sezione…), 8 regole (`regole_agenti`), mail viste (`mail_viste`); stessi id del gestionale, quindi la copia si può rifare senza doppioni. Nell'app: Dentro → Aziende (fatta come nell'app Ceramex: mandanti, sezioni, filiali, vista per sezione o per data; per ora solo lettura). Fino allo switch le note clienti si correggono nel gestionale Ceramex. Tappa 2 FATTA (11.10.2026): copia automatica ogni 10 minuti. Le routine "Bozze mail" restano invariate e scrivono in Ceramex; la funzione `copia-ceramex` (pg_cron, token `copia_token` nel Vault, segreti `CERAMEX_DB_URL` e `COPIA_TOKEN`) legge Ceramex con `brain_lettore` e copia schede, note, regole e mail viste (stessi id); le note sparite da Ceramex vanno nel cestino. Esito in `copia_registro`; Oggi avvisa se fallisce o è ferma da più di un'ora. Password e token si rifanno con `node scripts/collega-ceramex.mjs` (poi va reimpostato l'hash in Ceramex). **Da riguardare con Giovanni (sua richiesta):** come far scrivere l'agente note direttamente nel second brain e lo switch (tappa 3). Parcheggiati: link "dalla mail" verso Spark; cambiare la chiave segreta Ceramex che sta in `Documenti\ceramex\reader\.env.example`.
3. Calendario.
4. Chiedi (Haiku + Sonnet).
5. G&C.
6. Privato.
7. WhatsApp.
8. Rifiniture: senza rete, widget, scorciatoia vocale, foto cercabili.

## Primo passo
1. Guida Giovanni nella creazione del token personale Supabase, un passo alla volta. Poi fallo salvare come variabile d'ambiente, senza che lo mostri in chat.
2. Guarda come sono costruite e pubblicate le due app in `Documenti\ceramex` e `Documenti\gchomeconcepts`, solo in lettura, per usare lo stesso metodo.
3. Proponi la struttura del database della fase 1. **Chiedi conferma** prima di creare il progetto Supabase, perché è nel piano Pro e costa.
