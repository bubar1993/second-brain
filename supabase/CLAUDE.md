# Promemoria per la cartella supabase/

Progetto second-brain `vgurncqvgulldolhetyr`. I dettagli delle singole funzioni stanno nei file di `docs/`.

- SQL e migrazioni: `scripts/sql.ps1 -File x.sql [-Nome migrazione]`. I file delle migrazioni stanno in `migrations/`.
- Deploy di una funzione: `npx --yes supabase@2 functions deploy <fn> --project-ref vgurncqvgulldolhetyr --no-verify-jwt --use-api`.
- Tabella nuova: rilanciare la migrazione `mcp_solo_lettura` (i token dei connettori non scrivono) e il blocco "capo vede tutto" della migrazione `capo`; dare i permessi solo agli agenti che servono (lavoro ≠ privato).
- Funzione nuova chiamata dall'app con l'accesso di Giovanni: oltre a `utente.id === UTENTE`, rifiutare i token dei connettori con `daConnettore(jwt)` (`functions/_shared/accesso.ts`).
- Funzione "security definer" nuova: revoke da public/anon, grant ad authenticated, service_role e ai ruoli agente_*.
- La lettura dal database va sempre a pezzi da 1000 (`tutte()`): PostgREST non dà più di 1000 righe.
- `functions/_shared/strumenti.ts` è la fonte unica degli strumenti di sola lettura dell'AI: l'area la impone il server, mai il modello.
- Prove: col copia_token e `prova: true` dove c'è (notifiche, rubrica pulisci, riordino-mail, chiedi-ai). Niente mail o notifiche di prova verso Giovanni.
- Gestionali Ceramex e G&C: solo lettura con `brain_lettore`, non dargli altri permessi.
- Posta: `posta-gc` legge info@ in SOLA LETTURA (non segna come letto). Le mail si spostano solo con `riordino-mail`, quando Giovanni le ha scelte nell'app.
- Segreti: solo come segreti Supabase o variabili di Windows, mai in file o su git.
