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

### Fase 1 e backup (dalla lista delle fasi)

1. **Base** — FATTA (11.10.2026): progetto Supabase, app installabile, 3 tasti, tre aree, Inbox, Persone, accesso con volto/impronta. Il backup su Drive è stato spostato a inizio fase 2 (decisione di Giovanni): finora bastano i backup giornalieri di Supabase Pro (7 giorni, senza foto).

Il backup su Drive (funzione `backup`, ogni domenica notte, cartella BRAIN/Backup) è descritto nella fase 2 in `ceramex.md`.

## Primo passo

(Fatto l'11.10.2026: resta come storia.)

1. Guida Giovanni nella creazione del token personale Supabase, un passo alla volta. Poi fallo salvare come variabile d'ambiente, senza che lo mostri in chat.
2. Guarda come sono costruite e pubblicate le due app in `Documenti\ceramex` e `Documenti\gchomeconcepts`, solo in lettura, per usare lo stesso metodo.
3. Proponi la struttura del database della fase 1. **Chiedi conferma** prima di creare il progetto Supabase, perché è nel piano Pro e costa.
