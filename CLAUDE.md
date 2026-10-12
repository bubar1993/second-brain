# Second Brain GF

Questo file è per Claude Code. Spiega il progetto e le regole di lavoro. Ultimo aggiornamento: 12.10.2026 notte (schede persona, agenti delle note, WhatsApp).

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
- Gestionale G&C: progetto Supabase `hnpesqsteytwfgrsrygn`, cartella `Documenti\gchomeconcepts`. Anche qui c'è l'utente di sola lettura `brain_lettore` (creato l'11.10.2026 con l'ok di Giovanni): legge solo `clients`, `sites`, `price_list_suppliers`, `email_messages`. Non dargli altri permessi.
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
**Stato (12.10.2026 notte, ok di Giovanni l'11.10 sera):**
- `copia-gc` (ogni ora): clienti → `aziende` area G, cantieri (`sites`, di solito O0…) → `cantieri`, fornitori principali → `fornitori` (`nome_breve` = come appare nelle note), mail salvate nel gestionale → `posta` con cliente/cantiere. Segreto `GC_DB_URL`.
- `posta-gc` (ogni 5 minuti): legge info@homeconcepts.ch via IMAP Hostpoint in SOLA LETTURA (non segna come letto), TUTTE le cartelle tranne cestino/spam/bozze (Giovanni archivia per cliente e cantiere: "Archive/CLIENTI /<cliente>/<O0…>", il percorso sta in `posta.cartella_imap`). Stato per cartella in `posta_stato`; scarica solo il testo (niente allegati) e lavora max 60 s per giro, perché la funzione ha poco calcolo (WORKER_RESOURCE_LIMIT). Poi annulla le bozze superate. Password nel segreto `GC_MAIL_PASSWORD` (messa da Giovanni il 12.10). Storico della casella letto tutto il 12.10 notte (~2'400 mail).
- Scheda "G&C" di Ceramex (vendite G&C annotate dall'agente Ceramex): il 12.10 le sue 146 note sono passate in area G nelle schede dei clienti giusti (35 nel parcheggio "G&C" area G, id 823be55a…), la scheda Ceramex è nascosta. `copia-ceramex` ora manda le nuove note di quella scheda nel parcheggio G e non tocca più le note già passate in G; l'agente G&C le smista.
- Bozze: tabella `bozze`, schermata Bozze nell'app (Oggi → "bozze G&C da approvare", sul PC voce nel menu). "Approva e invia" (due tocchi) chiama `invia-bozza`: SMTP Hostpoint da info@ come risposta nel thread + copia in "Sent". Niente mail di prova.
- Agente G&C: regole in `agenti/agente-gc.md` (una sola fonte). Usa il database solo via `node scripts/agente-sql.mjs` → funzione `agente-sql` → utente Postgres `agente_gc` che vede e scrive SOLO l'area G (niente Privato, niente Ceramex, niente cancellazioni). Token nella variabile di Windows `AGENTE_TOKEN_GC` e nel segreto `AGENTE_TOKEN`; password del ruolo con `node scripts/collega-agente.mjs`.
- **Agente G&C in cloud (dal 12.10.2026, anche a PC spento):** due routine claude.ai uguali, "Agente G&C (ore piene)" `trig_0167WFkRzohRBwGMJKA5PQCi` e "Agente G&C (mezz'ora)" `trig_01WUMfFZV9XKDSRTwH5HREoz` (le routine non possono girare più spesso di 1 ora), 7–22, modello Sonnet 5.5, ambiente cloud "Second Brain" `env_01PB4PipgHbcKZ2E8MT8p2Jh` (rete personalizzata: solo `vgurncqvgulldolhetyr.supabase.co`), connettori ridotti a Claude Docs. Le istruzioni sono nel prompt della routine (riassunto di `agenti/agente-gc.md`: se si cambiano le regole, aggiornare anche le routine); il token `AGENTE_TOKEN` sta nel prompt (vede solo l'area G). Se si rigenera il token con `collega-gc.mjs`, aggiornare le due routine. Routine di prova "Prova rete second brain (da cancellare)" `trig_01DQbeedPfyH6bW7N6D7xvfd` disattivata.
- L'attività programmata del PC "Agente G&C" (`agente-gc`) è SPENTA: si riaccende solo se il cloud smette di funzionare. Giovanni lascia "Bypass permissions" su questa sessione per far lavorare Claude di notte. Ha il permesso SOLO per `node scripts/agente-sql.mjs` (`.claude/settings.json`), niente bypass: legge mail di estranei. Nei comandi niente `$`, backtick o virgolette doppie dentro l'SQL (PowerShell li interpreta e il permesso non scatta: l'attività resta bloccata): le routine claude.ai in cloud non raggiungono il second brain (il proxy blocca `*.supabase.co`). Per spostarlo in cloud Giovanni deve aprire la rete dell'ambiente su claude.ai.
- Storico: note ricostruite dalle 1'851 mail salvate nel gestionale (settembre 2025 → oggi); lo storico IMAP lo smaltisce l'agente un pezzo per giro.
- Scheda azienda G&C: fornitori al posto dei mandanti, linguette dei cantieri, "dalla mail" apre la conversazione nell'app. Chiedi trova anche i cantieri (O0214).

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

### Schede persona e agenti delle note (12.10.2026 notte, ok di Giovanni)
- **Schede persona** (`#/persona/<id>`): chi è, ditte, contatti (Chiama/WhatsApp/mail), riassunto per area scritto dagli agenti (`persone_riassunti`: da chiedere, cose aperte, ultimo contatto, chi è, come parlarle), promemoria, note, mail G&C, WhatsApp. I nomi nelle schede aziende e nelle note si toccano per aprirla. Nella ricerca persone c'è area e ditta: "David (Ceramex, Gaffuri)". Una persona è UNA riga anche se sta in più aree; le note restano nella loro area.
- Le persone nascono dai contatti delle schede aziende: `sincronizza_persone()` (pg_cron ogni 15 min) le crea/aggiorna (solo campi vuoti), le lega alle ditte (`persone_aziende`) e collega le note con "contatto" se il nome porta a UNA persona. Collega anche i contatti WhatsApp per numero.
- `copia-ceramex` mette nel cestino solo le note con `da_ceramex = true` (le note scritte nell'app restano anche nelle schede Ceramex).
- **Agenti delle note** (routine claude.ai, gratis col piano Max, ambiente "Second Brain", solo connettore Claude Docs):
  - "Agente note lavoro" `trig_012xsQNDrzFNnpAszr9gsGBh` (:15, 7–22), utente DB `agente_lavoro` (C+G, più smistamento Inbox: le note private le sposta in P e basta). Regole: `agenti/agente-note.md`.
  - "Agente privato" `trig_014BzqnSAWeuSq97vzQdwG15` (:45, 7–22), utente DB `agente_privato` (solo P). Regole: `agenti/agente-privato.md`.
  - Porta unica `agente-sql`: il token sceglie l'utente (AGENTE_TOKEN = G&C, AGENTE_TOKEN_LAVORO, AGENTE_TOKEN_PRIVATO, AGENTE_TOKEN_CALENDARIO; variabili di Windows con lo stesso nome). Password/token: `node scripts/collega-agente.mjs lavoro|privato|calendario|gc`. Se si cambiano le regole o il token, aggiornare il prompt della routine.
  - Dubbi → tabella `domande` → schermata "Domande per te" (Oggi la segnala). Lavoro fatto → `note.lavorata_il` e `lavori_registro`.
  - Attenzione: le routine create via API prendono TUTTI i connettori dell'account: ridurli sempre a Claude Docs (o al solo connettore che serve, passando `mcp_connections` già nella creazione).
  - Gli agenti scrivono anche il **punto del mattino e della sera** (`riassunti_giorno`, una riga per parte lavoro/privato) e **propongono appuntamenti** (`eventi` stato 'proposto') trovati nelle note.

### Calendario (fase 3, 12.10.2026 notte)
- Routine "Agente calendario" `trig_01ExFtoP2zGTkQDT4mnTdzGD` (:05, 6–22), connettore Google Calendar dell'account claude.ai di Giovanni (unico connettore), utente DB `agente_calendario` (solo `eventi` + nomi di ditte/persone). Regole: `agenti/agente-calendario.md`.
- Copia gli eventi di giovannifabris@ceramex.ch (da 2 giorni fa a 45 avanti) in `eventi` con area, ditta e persona. Crea in Google SOLO gli eventi approvati da Giovanni nell'app (stato 'da_creare'), senza invitati. Non cancella né sposta niente in Google.
- Oggi: appuntamenti di oggi e dei prossimi 7 giorni (tocco = scheda persona/ditta prima della visita; dopo l'appuntamento = "Annota" con la persona già collegata), proposte "Da mettere in calendario? Sì/No", punto del mattino/sera, compleanni (14 giorni).
- Un solo calendario Google (scelta di Giovanni, 12.10.2026): l'area si vede dal **colore**, messo in automatico dall'agente (C mirtillo 9, G basilico 10, P mandarino 6, sempre senza notifiche). In `eventi.colore` resta il colore messo dall'agente: se Giovanni ne cambia uno a mano in Google, l'agente non lo tocca più.

### Chiedi (fase 4, gratis)
- Funzione SQL `cerca(q, area_scelta, quanti)`: ricerca italiana (radici, parole vuote tolte, nomi di ditte/persone pesano 4) in note, mail G&C, riassunti persone, WhatsApp. Ordina per parole trovate, poi note prima delle mail e cose recenti. L'app la usa al tasto Invio; clienti e cantieri restano istantanei mentre scrivi.
- Risposte scritte dall'AI: parcheggiate (serve chiave a pagamento). Alternativa gratuita da proporre: connettore "Second Brain" (solo lettura) nell'app Claude del telefono, coperto dal piano Max.

### Privato (fase 6, primo pezzo)
- Promemoria `ricorrenza = 'annuale'` (quando si segna fatto torna l'anno dopo): gomme, cassa malati (confronto e disdetta entro 30.11), vignetta, dichiarazione d'imposta TI.
- Domande per Giovanni (agente privato): scadenze documenti, auto, abbonamenti, compleanni.

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
5. G&C ← IN CORSO (partita l'11.10.2026 sera, prima delle fasi 3-4, su richiesta di Giovanni). Vedi "G&C (fase 5)".
6. Privato.
7. WhatsApp ← IN CORSO (12.10.2026). Cloud API di Meta in "coesistenza" (il numero resta nell'app WhatsApp Business del telefono). Fatto: app Meta "Second Brain GF" (id 1050142621357706, portfolio Ceramex 196300470244482, Tech Provider, PUBBLICATA da Giovanni), webhook → funzione `whatsapp` (firma con WA_APP_SECRET, provato), funzione `whatsapp-collega` (scambio codice, iscrizione, richiesta contatti + storico 6 mesi, una volta sola entro 24 h), tabelle `wa_collegamento`/`wa_contatti`/`wa_messaggi`, pagina `public/privacy.html`, configurazione "ES Config" 1143212528277399. Segreti: WA_APP_SECRET, WA_VERIFY_TOKEN, WA_COLLEGA_TOKEN (`node scripts/collega-meta.mjs`). **Stato 12.10.2026:** azienda verificata, ma l'iscrizione integrata offre solo numero nuovo/virtuale perché l'app non ha l'accesso avanzato: serve l'**Analisi dell'app** di Meta (bozza pronta su Meta, testi e piano dei video in `docs/meta-analisi-app.md`). Per video e chiamate di prova si usa il numero di prova di Meta (+1 555 645 6202, `node scripts/whatsapp-prova.mjs <waba> <phone_id>` col token negli appunti). Schermata "Modelli di messaggio" + funzione `whatsapp-modelli`. **Mai** scegliere "numero virtuale". Poi aggancio con QR insieme a Giovanni (Embedded Signup v4, featureType whatsapp_business_app_onboarding) e chiamata a `whatsapp-collega` entro 24 h. Scrivere dall'app: gratis entro 24 h dall'ultimo messaggio del contatto, fuori solo modelli approvati (a pagamento). Pronto: funzione `invia-whatsapp` (solo Giovanni, controlla le 24 h) e schermate `#/whatsapp` (elenco chat, conversazione con area/persona/"tieni più dettagli", scrivi con due tocchi). **Note vocali** (12.10.2026): trascritte gratis sul PC con Whisper `large-v3-turbo` sulla RTX 4070. Attività di Windows "Second Brain - note vocali" (ogni 5 min, solo a PC acceso) → `scripts/trascrivi-vocali.py` (ambiente Python in `%USERPROFILE%\.secondbrain\whisper-venv`, NON in AppData: da Claude finirebbe nella cartella virtuale dell'app; installazione con `scripts/trascrivi-vocali.ps1`) → funzione `whatsapp-vocali` (chiave TRASCRIVI_TOKEN, variabile di Windows e segreto). La trascrizione va in `wa_messaggi.testo` (`trascrizione` = 'fatta' o 'errore: …') e `vista_il` torna vuoto, così gli agenti la rileggono. Meta tiene i file 30 giorni. Storico: lavoro → schede clienti; privato molto filtrato; Lady di Blackwood (fidanzata) `approfondita = true`, si tiene molto di più.
8. Rifiniture: senza rete, widget, scorciatoia vocale, foto cercabili.

## Primo passo
1. Guida Giovanni nella creazione del token personale Supabase, un passo alla volta. Poi fallo salvare come variabile d'ambiente, senza che lo mostri in chat.
2. Guarda come sono costruite e pubblicate le due app in `Documenti\ceramex` e `Documenti\gchomeconcepts`, solo in lettura, per usare lo stesso metodo.
3. Proponi la struttura del database della fase 1. **Chiedi conferma** prima di creare il progetto Supabase, perché è nel piano Pro e costa.
