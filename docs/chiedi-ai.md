# Chiedi e AI

Ricerca per parole e per significato, connettore "Second Brain" (mcp), risposta dell'AI in Chiedi con i crediti API. Testo spostato così com'era da CLAUDE.md il 14.10.2026 (versione intera nel tag git `prima-divisione-claude-md`).

### Chiedi (fase 4)
- Cerca ovunque: note, mail, WhatsApp, calendario, Drive, gestionali.
- Funziona su più aree insieme e cerca per significato.
- Ogni risposta ha il link alla fonte.

### Chiedi (fase 4, gratis)
- Funzione SQL `cerca(q, area_scelta, quanti)`: ricerca italiana (radici, parole vuote tolte, nomi di ditte/persone pesano 4) in note, mail G&C, riassunti persone, WhatsApp. Ordina per parole trovate, poi note prima delle mail e cose recenti. L'app la usa al tasto Invio; clienti e cantieri restano istantanei mentre scrivi.
- **Ricerca per significato** (13.10.2026, gratis, ok di Giovanni): tabella `vettori` (tipo nota|mail|persona|whatsapp, rif, impronta = md5 del testo, vettore 1024) con il modello multilingue `@cf/baai/bge-m3` di Cloudflare Workers AI. Il Worker dell'app ora ha un pezzo di codice (`worker/index.js`, `wrangler.jsonc`: `main`, binding `AI` e `ASSETS`, `run_worker_first: /api/*`): `/api/vettori` risponde solo col segreto `VETTORI_TOKEN` (segreto del Worker, segreto Supabase e variabile di Windows). Funzione `significato`: `indicizza` (pg_cron 'significato' ogni 10 min, copia_token; le cose nuove o cambiate, via `vettori_da_fare()` / `testi_significato()`) e `cerca` (Giovanni; `cerca_significato()`, somiglianza ≥ 0.5). Tetto 12 milioni di caratteri al giorno (`vettori_uso`), così si resta sempre nella quota gratuita di Workers AI (10'000 neurons/giorno). Chiedi mostra "Parlano della stessa cosa" sotto i risultati per parole (solo quelli non già trovati). Migrazione `significato`.
- Risposte scritte dall'AI: con il **connettore "Second Brain"** nell'app Claude (gratis col piano Max, ok di Giovanni 12.10.2026). Funzione `mcp` (server MCP solo lettura: cerca, agenda, azienda, persona, nota, mail; `--no-verify-jwt`, controlla da sé il token e che sia di Giovanni). Indirizzo del connettore: `https://vgurncqvgulldolhetyr.supabase.co/functions/v1/mcp`. Accesso col server OAuth 2.1 di Supabase Auth (acceso, registrazione dinamica sì, pagina di consenso `/oauth/consent` dell'app = `src/Consenso.jsx`, accetta solo ritorni a claude.ai/claude.com). Regole "connettori solo lettura" (migrazione `mcp_solo_lettura`): i token con `client_id` non possono scrivere in nessuna tabella; **per le tabelle nuove rilanciare quella migrazione**. Attenzione: un connettore dell'account finisce anche nelle routine nuove create via API (ridurle sempre).

### Risposta dell'AI in Chiedi (14.10.2026, crediti API del piano Max; analisi controllata da un agente "contrario", ok di Giovanni)
- Il piano Max 5x dà **100 $ al mese di crediti API** (si azzerano a ogni ciclo, non si accumulano). Valgono solo con una chiave API dell'organizzazione Console collegata da Giovanni il 14.10.2026 (il collegamento non si cambia da soli). NON valgono per Claude Code né per le routine: per questo il Capo e gli agenti restano come sono. Finiti i crediti l'API dà errore e basta: **nessuna carta e nessuna ricarica automatica nell'organizzazione**.
- Chiave: segreto `ANTHROPIC_API_KEY`. Si salva con `node scripts/salva-chiave-api.mjs` dagli appunti (controlla anche che i modelli ci siano; mai in chat). Senza chiave la funzione risponde `{ pronta: false }` e Chiedi resta com'era.
- Funzione `chiedi-ai` (`--no-verify-jwt`, controlla da sé che sia Giovanni dall'app: i token dei connettori, con `client_id`, sono rifiutati): risponde subito con l'id, lavora in sottofondo (`EdgeRuntime.waitUntil`) e scrive in `ai_risposte` (in_corso → fatta | errore); l'app la rilegge ogni 1,5 s, anche tornando nell'app, e dopo 3 minuti dice "riprova". Modello Sonnet 5.5, al massimo 6 chiamate per domanda (l'ultima senza strumenti), cache sul prompt.
- Strumenti di SOLA LETTURA in `supabase/functions/_shared/strumenti.ts` (cerca per parole + per significato, agenda, azienda, persona, leggi): l'**area la impone il server** (quella scelta in alto), mai il modello; con un'area scelta non escono note, riassunti, ditte o mail delle altre. Ogni cosa trovata ha un numero [n]; la risposta è testo semplice e i link li fa il server dalle fonti citate. È la fonte unica da ora: il connettore `mcp` ha ancora la sua copia vecchia (da passare a questo file con l'ok di Giovanni; lì l'area non serve, l'app Claude non ne sceglie una).
- Spesa: `ai_uso` (una riga per chiamata, costo dai token), `ai_spesa(da)`, tetti in `ai_impostazioni` (`inizio_ciclo` = giorno del mese in cui arrivano i crediti, da correggere se serve; oltre 70 $ nel ciclo passa a Haiku 5.5 con la riga "Risposta veloce", oltre 90 $ si ferma; 15 $ al giorno solo contro errori). Prezzi in `chiedi-ai` (pagina prezzi del 14.10.2026).
- Prove senza Giovanni: col copia_token `{ prova: 'strumento', nome, argomenti, area }` (non chiama Claude) o `{ domanda, prova: true }` (riga segnata `prova`). Migrazioni `chiedi_ai`, `chiedi_ai_spesa`.
- Gli stessi crediti li usa anche la risposta veloce del Capo (16.10.2026, `capo-veloce`, vedi `docs/capo.md`): prezzi, spesa e tetti comuni in `_shared/ai.ts`.
- Prossime idee proposte (non fatte): "Prima della visita" sull'appuntamento in Oggi; foto cercabili.

### Intelligenza artificiale: idea di partenza (11.10.2026)

Intelligenza artificiale (dettagli da decidere prima della fase 4):
- Haiku per le domande semplici nell'app.
- Sonnet per il tasto "Domanda difficile" (stima 5–15 CHF/mese).
- Ragionamenti lunghi: app Claude, coperta dal piano Max.
