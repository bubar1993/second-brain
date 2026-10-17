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

## Primo passo

(Fatto l'11.10.2026: resta come storia.)

1. Guida Giovanni nella creazione del token personale Supabase, un passo alla volta. Poi fallo salvare come variabile d'ambiente, senza che lo mostri in chat.
2. Guarda come sono costruite e pubblicate le due app in `Documenti\ceramex` e `Documenti\gchomeconcepts`, solo in lettura, per usare lo stesso metodo.
3. Proponi la struttura del database della fase 1. **Chiedi conferma** prima di creare il progetto Supabase, perché è nel piano Pro e costa.
