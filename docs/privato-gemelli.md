# Privato e gemelli

Area Privato: gemelli, figli di Lady di Blackwood, scadenze, liste, garanzie, vacanze scolastiche, idee parcheggiate. Testo spostato così com'era da CLAUDE.md il 14.10.2026 (versione intera nel tag git `prima-divisione-claude-md`).

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

### Privato (fase 6, primo pezzo)
- Promemoria `ricorrenza = 'annuale'` (quando si segna fatto torna l'anno dopo): gomme, cassa malati (confronto e disdetta entro 30.11), vignetta, dichiarazione d'imposta TI.
- Domande per Giovanni (agente privato): scadenze documenti, auto, abbonamenti, compleanni.

### Gemelli (fase 6, 12.10.2026)
- Leonardo ("Leo") e Jolie, nati il 03.05.2018, terza elementare. Persone area P con ruolo 'figlio'/'figlia'. Leo: calcio, tennis. Jolie: Gymnastique, atletica, Fashion design. Tutti e due pianoforte martedì 16:30–18:00. Accompagna Giovanni o vanno a piedi.
- Schermata "Gemelli" (`#/gemelli`, in Dentro e nel menu del PC): questa settimana (attività fisse + appuntamenti P che li riguardano + feste), feste dei compagni (Ci va / Non ci va / Regalo preso), attività fisse, diario (note collegate ai bambini), "+ Leo" / "+ Jolie".
- Tabelle `attivita_figli` e `feste` (le aggiorna l'agente privato dalle note e dal calendario; regole in `agenti/agente-privato.md`, ora allineato alla routine).
- **Pianoforte di Leo e Jolie** (14.10.2026): martedì 17:00–18:30 (non più 16:30–18:00), nel calendario Google come evento ricorrente "Pianoforte Leo e Jolie" (mandarino 6) **solo nei giorni di scuola**: niente nei martedì di vacanza (EXDATE) e fine il 16.6.2027. Ogni anno scolastico va rifatto, insieme alle vacanze. La schermata Gemelli non mostra due volte un'attività fissa che è anche nel calendario.
- **Davide e Celeste Russo, figli di Lady di Blackwood** (14.10.2026, migrazioni `figli_lady` e `persone_ordine`): persone area P (ruolo "figlio/figlia di Lady di Blackwood", `persone.sotto_id` = Lady), capitoli del quaderno sotto quello di Lady (`quaderno_capitoli.sotto_id`). Menu a tendina sotto Lady sia nel quaderno Privato sia in Dentro → Persone. (Le due schede "Davide"/"Celeste" senza cognome fatte per sbaglio sono nel cestino: Giovanni li aveva già scritti come Russo.)
- **Ordine dell'elenco Persone** (14.10.2026, scelta di Giovanni): in cima sempre Lady di Blackwood, Leonardo, Jolie (`persone.in_cima` 1–3), poi per uso = note + messaggi WhatsApp + appuntamenti (vista `persone_uso`), poi per nome. Con la ricerca l'elenco è piatto. Attività in `attivita_figli` ma **NON nel calendario** (scelta di Giovanni): Davide pianoforte martedì 17–18:30, basket lunedì e mercoledì 18:30–20; Celeste Gymnastique giovedì 16:45. Si vedono nel loro capitolo ("Attività fisse"), non in Gemelli (che mostra solo le attività di Leo e Jolie).

### Vacanze scolastiche, liste, garanzie, notifiche (13.10.2026 notte, ok di Giovanni)
- **Vacanze scolastiche** dei gemelli (scuola a Torricella-Taverne, calendario cantonale Ticino 2026/27, fonte lugano.ch/DECS): create da Claude nel calendario Google come eventi **"Scuola chiusa: …" dalle 6 alle 7** (NON tutto il giorno, scelta di Giovanni), uno ricorrente per periodo, colore **Pavone (7)**, libero, senza promemoria. Periodi: autunnali 31.10–8.11, Immacolata 8.12, Natale 24.12–6.1, Carnevale 6–14.2, San Giuseppe 19.3, Pasqua 26.3–4.4 (alcune scuole dal 24.3: da verificare), Ascensione+ponte 6–7.5, Pentecoste 17.5, Corpus Domini 27.5, estive 17.6–29.8.2027. L'agente calendario non tocca il colore (diverso dal suo). Nell'app non sono appuntamenti: in Oggi si vedono accanto al giorno ("Scuola chiusa: …", azzurro `--pavone`), in Gemelli sul giorno e "Prossima scuola chiusa". Non danno notifiche. Ogni anno scolastico vanno rifatte (prossimo: 2027/28).
- **Liste** (`#/liste`, Dentro, solo P e Tutte; `src/Liste.jsx`, tabella `liste_voci`): solo **Spesa** (spunta = preso, "Presi di recente" per rimetterli) e **Ristoranti e posti** (da provare / provati, stelle 1–5). Dal + si detta "metti il latte e il pane nella spesa" o "grotto del Mulino consigliato da Paolo": `src/capisci.js` lo riconosce subito (senza AI), Aggiungi mostra "Va nella spesa: …" con "No, è una nota"; senza foto non crea la nota. Un ristorante senza consigliato/provato/voto/"nei ristoranti" resta una nota (può essere un appuntamento).
- **Garanzie** (`#/garanzie`, tabella `garanzie`, `scade_il` calcolata da `comprata_il` + `mesi`): foto dello scontrino dal + con "garanzia lavatrice Fust 2 anni" (senza durata: 2 anni; una data nel testo = giorno d'acquisto). La nota va in P con `lavorata_il` già messo (gli agenti non la rileggono). **Nessun avviso di scadenza** (scelta di Giovanni), solo l'elenco con la miniatura.
- L'agente privato (`agente_privato`) dal 13.10.2026 sera (ok di Giovanni, regole + routine aggiornate, punto 2d–f): dalle note private aggiunge ristoranti/posti (da provare, provati, voto) e cose della spesa, crea le garanzie dalle note non fatte dall'app e mette le note nei temi del quaderno; capitoli nuovi solo dopo una domanda e il sì di Giovanni.

### Sonos: annunci e sveglie (21.10.2026, ok di Giovanni, in corso)
- Integrazione "Second Brain" su developer.sonos.com (Direct Control, account Sonos di Giovanni), chiave e segreto nei segreti `SONOS_KEY` / `SONOS_SECRET`. Indirizzo di ritorno: la funzione `sonos`.
- Funzione `sonos` (Giovanni dall'app o x-copia-token): `collega` (link di autorizzazione, 15 min), `casse`, `annuncio` (`cassa` nome o id, `volume`, `testo`, `stile`; senza testo il din-don di Sonos).
- Voce (scelta di Giovanni): **Gemini 3.1 Flash TTS, voce Laomedeia**, chiave gratuita `GEMINI_API_KEY` (AI Studio, progetto "Second Brain", separato da "Gestionale"; Giovanni non vuole spendere e accetta che Google usi i testi). Frasi salvate nel bucket privato `voci` (nome = sha256 di modello|voce|stile|testo, WAV 24 kHz): la stessa frase non si rifà. Prima prova in Camera Mia il 21.10, ok. Token solo in `sonos_collegamento` (nessun permesso a app, agenti, Capo: esclusa dal blocco "capo vede tutto"); l'app legge `sonos_stato`.
- Casse (tutte fanno gli annunci): Camera Mia, Corridoio, Bambini, Salotto. Collegato il 21.10, prova din-don in Camera Mia riuscita.
- Prove da qui senza vedere il token: `net.http_post` dal database con `copia_token` del Vault, poi `net._http_response`.
- **Sveglie** (21.10.2026, scelte di Giovanni): tabella `sonos_sveglie` (nessun permesso all'app per ora), pg_cron `sonos-sveglie` ogni minuto chiama `sonos` {azione:'sveglie'} solo se `sonos_sveglie_da_fare()` ne trova una (da un minuto prima a 10 dopo l'ora di Zurigo, una volta al giorno: `ultima_il`). Flusso: meteo Open-Meteo (Torricella-Taverne) → testo di Claude Haiku (crediti Max, spesa in `ai_uso` + 0,01 $ a ricerca; per Giovanni 2-3 notizie di ieri, borsa/attualità, con la ricerca web) → voce Laomedeia (`voci/sveglie/<id>.wav`, riscritta ogni volta) → annuncio → finita la voce, Preferito Sonos a volume dolce, in ordine casuale. `salta_vacanze` = niente sveglia nei giorni "Scuola chiusa" (`eventi`). Esito in `ultimo_testo` / `errore`. Prova: {azione:'sveglia_prova', id, cassa, musica:false}.
  - Bimbi lun–mer 07:00, Bambini, "Buongiorno Leo e Jolie, dormito bene?" → Alternative; salta vacanze.
  - Bimbi gio–ven 07:10, Bambini, "Buongiorno Leo, Jolie, Davide e Celeste, dormito bene?" → Alternative; salta vacanze.
  - Giovanni lun–mer 06:50, Camera Mia, "Buongiorno Giovanni!" + notizie → Preferito "Worakls".
  - Giovanni gio–ven 07:00, Camera Mia, "Buongiorno Amore!" + notizie → Preferito "Blink-182".
  - Volumi: voce 25, musica 15.
- Da fare: comando dal + ("annuncio bambini: a tavola!"); accendere/spegnere le sveglie dall'app.

### Idee parcheggiate
- ~~Risposta scritta dall'AI dentro l'app (Chiedi)~~: fatta il 14.10.2026 con i crediti API del piano Max (vedi "Risposta dell'AI in Chiedi").
- In sospeso (Giovanni, 13.10.2026): idee regalo, bozza di auguri, inviti da rispondere, spese condivise, diario della sera, obiettivi e abitudini, wishlist, cose prestate, riassunto della domenica sera, widget sul telefono, foto cercabili.

Vedi anche: `rubrica.md` (Lady di Blackwood e contatti privati), `calendario.md`, `schermate.md` (Quaderno, Notifiche).
