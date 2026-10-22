# Sicurezza e backup

Accesso all'app, sicurezza delle funzioni, backup su Drive, primo passo del progetto. Testo spostato così com'era da CLAUDE.md il 14.10.2026 (versione intera nel tag git `prima-divisione-claude-md`).

### Sicurezza
- L'app la usa solo Giovanni. Si apre con volto o impronta (passkey), senza PIN separato.
- Backup settimanale su Google Drive.
- Gli agenti di lavoro non leggono il Privato. Eccezione: impegni privati che si sovrappongono al lavoro.
- Uso senza rete e modalità scura: da valutare.

### Chiavi per leggere i gestionali (dall'architettura)

Per leggere i gestionali dal second brain si usa una chiave di sola lettura per ognuno, salvata come segreto nel progetto nuovo (fase 2).

### Sicurezza delle funzioni (12.10.2026 pomeriggio)

- Sicurezza (migrazione `sicurezza_funzioni`): le 4 funzioni "security definer" non rispondono più ad anon. Per funzioni nuove dello stesso tipo: revoke da public/anon, grant ad authenticated, service_role e ai ruoli agente_*.
- Token dei connettori (18.10.2026, controllo di sicurezza, ok di Giovanni): l'app Claude collegata (OAuth, token con `client_id`) può solo leggere con `mcp`. Le funzioni chiamate dall'app con l'accesso di Giovanni (invia-bozza, gmail-bozza, riordino-mail, invia-whatsapp, rubrica, agente-subito, whatsapp-modelli, significato; chiedi-ai e capo-veloce lo facevano già) rifiutano quei token con `daConnettore` di `_shared/accesso.ts`. La pagina di consenso dice di consentire solo se la richiesta l'ha appena fatta Giovanni. La registrazione dei connettori resta aperta: chiuderla bloccherebbe il ricollegamento dell'app Claude.
- Agenti senza internet dal database (18.10.2026, ok di Giovanni): `net.http_*` (pg_net) Supabase lo dà a PUBLIC e il nostro utente postgres non può toglierlo (provato). Quindi `agente-sql` rifiuta le istruzioni con `net.`, `http_*`, blocchi DO, `plpgsql`, `create function`, `pg_temp`, `query_to_xml`, `ts_stat`, `ts_rewrite`, `U&"…"` (risposta 403). Controllato prima su 2892 istruzioni vere degli agenti: nessuna fermata. I giri programmati (pg_cron, utente postgres) non passano da lì e funzionano come prima.
- Allegati delle mail (18.10.2026, ok di Giovanni): nel Riordino un allegato aperto conta come l'app (potrebbe leggere l'accesso salvato). Si aprono solo PDF, foto (jpeg, png, gif, webp, heic) e testo semplice (`TIPI_DA_APRIRE` in `src/Riordino.jsx`); il resto si scarica come file.
- `modifiche_claude`: il testo lo scrive il Capo, quindi è un dato; regola in CLAUDE.md (riassunto a Giovanni e suo sì prima di farla).

### Fase 1 e backup (dalla lista delle fasi)

1. **Base** — FATTA (11.10.2026): progetto Supabase, app installabile, 3 tasti, tre aree, Inbox, Persone, accesso con volto/impronta. Il backup su Drive è stato spostato a inizio fase 2 (decisione di Giovanni): finora bastano i backup giornalieri di Supabase Pro (7 giorni, senza foto).

Il backup su Drive (funzione `backup`, ogni domenica notte, cartella BRAIN/Backup) è descritto nella fase 2 in `ceramex.md`.
Dal 18.10.2026 i dati si leggono tabella per tabella, 500 righe alla volta (`backup_tabelle()` + `backup_export_pezzo()`, migrazione `backup_a_pezzi`): il 18.10 `backup_export()` in un colpo solo era stato fermato dal limite di 8 s. La tabella `vettori` (ricerca per significato) non va nel backup: si ricalcola dalle note. Rifatto a mano il 18.10 alle 18:58: ok, 3,6 MB.

## Guardiano (21.10.2026, ok di Giovanni)

Prima del 21.10 nessuno avvisava se un'app, un gestionale o un agente si fermava. Piano in 3 passi: (1) guardiano nel Brain — FATTO; (2) controllo esterno su Cloudflare per quando è giù il Brain stesso, con avvisi WhatsApp — codice pubblicato il 21.10, parte quando ci sono la chiave Meta e il modello approvato; (3) "Medico" che legge gli errori e propone la soluzione — prima parte FATTA il 22.10.2026 (ok di Giovanni): per ogni guasto nuovo il guardiano, in sottofondo, chiede all'AI (Sonnet, crediti API, tetti di `ai_impostazioni`, spesa in `ai_uso`) 2-4 righe su cosa vuol dire e cosa fare (aspettare / Manda a Claude / una cosa semplice per Giovanni) → `guasti.spiegazione` (migrazione `guasti_medico`), mostrata sotto il guasto in Oggi. Solo testo, nessuno strumento, non ripara niente. Prova: `{ prova: true, medico: { chiave, titolo, dettaglio } }`. Riparare da solo le cose sicure: non fatto.
- Funzione `guardiano`, pg_cron ai minuti 2/17/32/47 (copia_token; migrazioni `guardiano` e `guardiano_cron`). Controlla: le 3 app (risposta della pagina), i 2 gestionali (`select 1` con `brain_lettore`, segreti `CERAMEX_DB_URL`/`GC_DB_URL`), i giri in `lavori_registro` (elenco `GIRI` con orari di Zurigo: i minuti senza giri si contano solo nelle ore in cui il lavoro gira, così la notte non conta; più `GIORNALIERI` e `SETTIMANALI`), ultimo giro non riuscito, `copia_registro` (Ceramex, 40 min), backup (non riuscito o più di 8 giorni), richieste agli agenti ferme da più di 3 ore (6–23), lavori pg_cron falliti negli ultimi 30 minuti. Dal 22.10.2026 (ok di Giovanni, dopo la rubrica ferma dal 20 al 22.10 senza avviso) anche: funzioni chiamate dai lavori automatici che rispondono con errore (`net._http_response`, codice ≥ 400, almeno 2 in 30 minuti → guasto `http:errori` col testo dell'errore; pg_net non tiene l'indirizzo, quindi non sa quale funzione) e rubrica non sincronizzata da più di 1 ora (`giro:rubrica`, da `rubrica_stato.ultimo_giro`). Migrazione `guardiano_errori`. Le app e i gestionali si riprovano una volta dopo 4 s prima di dire guasto. Non ripara niente.
- Tabella `guasti` (una riga aperta per `chiave`, `chiuso_il` quando sparisce; l'app e il Capo la leggono, scrive solo il guardiano; i chiusi si cancellano dopo 60 giorni). `guardiano_dati()` (solo service_role) legge tutto il necessario in un colpo.
- `notifiche` manda "Guasto: …" all'apertura e "Risolto: …" alla chiusura (solo se il guasto era stato avvisato; stesso tag, quindi sul telefono "Risolto" prende il posto del guasto). In Oggi il riquadro rosso `AvvisoGuasti` (senza ripetere backup, copia Ceramex, posta e copia G&C, che hanno già il loro avviso).
- Prova: `{ "prova": true }` dice cosa trova senza scrivere né avvisare. Prima prova (21.10 sera): tutto a posto tranne "Archivia liste di carico Ceramex", che il 21.10 (e il 15.10) non ha lasciato il giro delle 6:52.
- In Oggi un solo riquadro rosso con tutti i guasti (dal 21.10 sostituisce i vecchi avvisi di backup, copia Ceramex, posta e copia G&C) e per ognuno il tasto **"Manda a Claude"**: scrive in `modifiche_claude` (stato 'ok', `guasto_id`, app ceramex/gc per `app:`/`db:` di quelle app, altrimenti brain). Claude lo trova col controllo di inizio sessione.
- **Passo 2, guardiano esterno** (cartella `guardiano-esterno/`, Worker Cloudflare `guardiano-esterno`, cron ogni 5 min, KV `guardiano-esterno-stato`; pubblicare con `npx wrangler deploy --config guardiano-esterno/wrangler.jsonc`): controlla l'app Brain e il "battito" (funzione `guardiano` con `x-esterno-token` = `ESTERNO_TOKEN` → `guardiano_battito()`: ultimo controllo del guardiano in `guardiano_stato`, ultimo giro riuscito delle notifiche). Problema in 2 controlli di fila → WhatsApp; quando sparisce → "Risolto". Senza i segreti non fa niente.
- **WhatsApp** (scelta di Giovanni 21.10): dal numero di prova di Meta (+1 555 645 6202, gratis, max 5 destinatari verificati) al numero di Giovanni, con il modello "avviso_guasto" (UTILITY, it, {{1}} titolo e {{2}} dettagli). Lo mandano `notifiche` (guasti del guardiano, insieme alla notifica) e il guardiano esterno (Brain giù). Chiave permanente di un utente di sistema Meta → `node scripts/salva-avvisi-whatsapp.mjs <numero>` dagli appunti: la prova, crea il modello, salva WA_AVVISI_TOKEN / WA_AVVISI_PHONE_ID / WA_AVVISI_A / ESTERNO_TOKEN nel Brain e nel Worker, svuota gli appunti. Il numero del Brain stesso (coesistenza) non va bene per gli avvisi: non può scrivere a sé.
- Fatto il 21.10 sera: utente di sistema Meta **AvvisiBrain** (portfolio Ceramex; "Guardiano Second Brain" Meta non lo accettava), chiave permanente salvata con lo script (legge il numero di prova; l'account WhatsApp di prova di Meta NON si può assegnare a un utente di sistema, quindi la chiave non vede i modelli). Modello `avviso_guasto` creato a mano da Claude in WhatsApp Manager (Test WhatsApp Business Account → Modelli di messaggio), Utility, italiano: "Aggiornamento di stato del tuo servizio Second Brain: {{1}}. Dettagli: {{2}}. Ti avviseremo di nuovo quando il servizio torna regolare." (le prime versioni "Avviso dal guardiano…" Meta le voleva come Marketing). Il guardiano esterno riceve il battito (log "giro {problemi:[]}" del 21.10 22:25). Se l'invio fallisce, l'errore è in `lavori_registro` 'notifiche' (`whatsapp: …`) o nei log del Worker (`npx wrangler tail guardiano-esterno`).

## Primo passo

(Fatto l'11.10.2026: resta come storia.)

1. Guida Giovanni nella creazione del token personale Supabase, un passo alla volta. Poi fallo salvare come variabile d'ambiente, senza che lo mostri in chat.
2. Guarda come sono costruite e pubblicate le due app in `Documenti\ceramex` e `Documenti\gchomeconcepts`, solo in lettura, per usare lo stesso metodo.
3. Proponi la struttura del database della fase 1. **Chiedi conferma** prima di creare il progetto Supabase, perché è nel piano Pro e costa.
