# G&C

Copia dal gestionale G&C, posta info@, agente G&C, bozze G&C.

### G&C (fase 5)
**Stato (12.10.2026 notte, ok di Giovanni l'11.10 sera):**
- `copia-gc` (ogni ora): clienti → `aziende` area G, cantieri (`sites`, di solito O0…) → `cantieri`, fornitori principali → `fornitori` (`nome_breve` = come appare nelle note), mail salvate nel gestionale → `posta` con cliente/cantiere. Segreto `GC_DB_URL`.
- `posta-gc` (ogni 5 minuti): legge info@homeconcepts.ch via IMAP Hostpoint in SOLA LETTURA (non segna come letto), TUTTE le cartelle tranne cestino/spam/bozze (Giovanni archivia per cliente e cantiere: "Archive/CLIENTI /<cliente>/<O0…>", il percorso sta in `posta.cartella_imap`). Stato per cartella in `posta_stato`; scarica solo il testo (niente allegati) e lavora max 60 s per giro, perché la funzione ha poco calcolo (WORKER_RESOURCE_LIMIT). Poi annulla le bozze superate. Password nel segreto `GC_MAIL_PASSWORD` (messa da Giovanni il 12.10). Storico della casella letto tutto il 12.10 notte (~2'400 mail).
- Scheda "G&C" di Ceramex (vendite G&C annotate dall'agente Ceramex): il 12.10 le sue 146 note sono passate in area G nelle schede dei clienti giusti (35 nel parcheggio "G&C" area G, id 823be55a…), la scheda Ceramex è nascosta. `copia-ceramex` ora manda le nuove note di quella scheda nel parcheggio G e non tocca più le note già passate in G; l'agente G&C le smista.
- Bozze: tabella `bozze`, schermata Bozze nell'app (Oggi → "bozze G&C da approvare", sul PC voce nel menu). "Approva e invia" (due tocchi) chiama `invia-bozza`: SMTP Hostpoint da info@ come risposta nel thread + copia in "Sent". Niente mail di prova.
- Agente G&C: regole in `agenti/agente-gc.md` (una sola fonte). Usa il database solo via `node scripts/agente-sql.mjs` → funzione `agente-sql` → utente Postgres `agente_gc` che vede e scrive SOLO l'area G (niente Privato, niente Ceramex, niente cancellazioni). Token nella variabile di Windows `AGENTE_TOKEN_GC` e nel segreto `AGENTE_TOKEN`; password del ruolo con `node scripts/collega-agente.mjs`.
- **Agente G&C in cloud (dal 12.10.2026, anche a PC spento):** routine claude.ai "Agente G&C (ore piene)", oggi alle 7:00 e 18:00 più le sveglie del portinaio (`agenti-routine.md`); la gemella "Agente G&C (mezz'ora)" è SPENTA dal 23.10.2026. Modello Sonnet 5.5, ambiente cloud "Second Brain" `env_01PB4PipgHbcKZ2E8MT8p2Jh` (rete personalizzata: solo `vgurncqvgulldolhetyr.supabase.co`), connettori ridotti a Claude Docs. Le istruzioni sono nel prompt della routine (riassunto di `agenti/agente-gc.md`: se si cambiano le regole, aggiornare anche la routine); il token `AGENTE_TOKEN` sta nel prompt (vede solo l'area G). Se si rigenera il token con `collega-gc.mjs`, aggiornare la routine.
- L'attività programmata del PC "Agente G&C" (`agente-gc`) è SPENTA: si riaccende solo se il cloud smette di funzionare. Ha il permesso SOLO per `node scripts/agente-sql.mjs` (`.claude/settings.json`), niente bypass: legge mail di estranei. Nei comandi niente `$`, backtick o virgolette doppie dentro l'SQL (PowerShell li interpreta e il permesso non scatta).
- Storico: note ricostruite dalle 1'851 mail salvate nel gestionale (settembre 2025 → oggi); lo storico IMAP lo smaltisce l'agente un pezzo per giro.
- Scheda azienda G&C: fornitori al posto dei mandanti, linguette dei cantieri, "dalla mail" apre la conversazione nell'app. Chiedi trova anche i cantieri (O0214).
- **Note dei fornitori** (29.10.2026, chiesto da Giovanni, piano controllato dall'antagonista): le mail solo col fornitore (senza cliente) diventano note con `azienda_id` null e `mandante` = `nome_breve` (punto 4b di `agenti/agente-gc.md`, a2 nel prompt della routine ore piene; la routine mezz'ora spenta non è stata cambiata). Le note dei rappresentanti vanno sotto il marchio (Freecem → Polis, Nordik Tile, BGP; Sariker/Ermanno Dri → Pamesa, Sichenia; Atega → Redsun; Swiss Surfaces → ABK; Gres Design → Savoia). Listini, aumenti, ferie e fiere restano circolari (agente "da seguire"). `nome_breve` dato a mano a Laguna, Pamesa, RAK, Tessere; **Sichenia** è una riga solo del second brain (non c'è nel gestionale G&C, `copia-gc` non la tocca). I fornitori nuovi che arrivano da `copia-gc` non hanno `nome_breve`: finché non glielo si dà, l'agente non scrive note per loro e non compaiono nel Quaderno. Recupero degli ultimi 3 mesi (177 mail) chiesto all'agente con 4 righe in `richieste_agenti` (29.10.2026 sera), senza toccare `vista_il` (se no il guardiano dà un falso guasto).

Note fatte come quelle Ceramex. Al posto dei mandanti ci sono i fornitori di tipo "principale" del gestionale G&C (`price_list_suppliers.kind = 'principale'`). Clienti presi da `clients`, cantieri da `sites`. Le 6 sezioni sono le stesse di Ceramex. L'agente legge la casella mail G&C. Si recupera lo storico mail 2026. I collaboratori vedono il gestionale G&C, ma non il second brain.

### Fase 5 (dalla lista delle fasi)

5. G&C ← IN SOSPESO (scelta di Giovanni, 26.10.2026; partita l'11.10.2026 sera). Vedi "G&C (fase 5)".

### Rappresentanti: scheda Sariker AG (10.11.2026, ok di Giovanni, piano controllato dall'antagonista)
- Sariker AG (Barbengo; Ermanno Dri e Ramon Zollinger; rappresentano Pamesa, Sichenia e altri) ha una scheda ditta normale in `aziende` area G (`a5394df7-24ca-4778-a198-a3e3eb6e1d5f`), fatta a mano: così ci sono le schede persona, il tasto nota e i WhatsApp. Non è un cliente. `email` e `domini` restano VUOTI apposta.
- Mail: resta la regola del 29.10, nota sotto il marchio con `azienda_id` null. L'agente G&C non usa mai la scheda Sariker per una mail e non le aggiunge mail, domini o contatti (`agente-gc.md` 4b, routine ore piene aggiornata e IDENTICA il 10.11).
- Note di Giovanni e WhatsApp: sulla scheda Sariker con `mandante` = marchio (`agente-note.md` 3a, routine aggiornata e IDENTICA il 10.11). La pagina del fornitore nel Quaderno mostra già anche queste note (cerca per `mandante`). Marchio fuori da `fornitori` = 'Altro'.
- Una persona = una scheda sola (niente "Ermanno Pamesa", "Ermanno Sichenia"): scelta del 10.11.
- I due contatti WhatsApp erano in area P (rubrica del telefono): spostati in G. I messaggi vecchi non si rimandano all'agente (farebbe promemoria con date sbagliate): le note si scrivono a mano con la data del messaggio.
- Altri rappresentanti (Freecem, Atega, Swiss Surfaces, Gres Design): Giovanni ha detto di aspettare. Se diventano tanti conviene un'etichetta "rappresentante" vera (colonna + app).

Vedi anche: `agenti-routine.md` (Archiviazione email G&C, Completa fornitori scontrini), `schermate.md` (Riordino casella, Bozze), `ceramex.md` (Da seguire e Circolari valgono anche per G&C), `calendario.md` (inviti a call nelle mail).

## Mail incerte di info@: dal Riordino alle schede (10.11.2026)
- Le mail che l'agente di archiviazione non sa dove mettere restano una riga in `modifiche_da_controllare` (G&C) e una proposta con ❓ nel Riordino del Brain.
- Quando Giovanni le sposta dal Riordino, l'agente le salva nel gestionale secondo la cartella scelta (regola SPOSTATA-DA-GIOVANNI, `agenti/agente-archiviazione-gc.md` passo 1b) e chiude la riga. Cartella nuova = scheda nuova con "Creato X: controlla". Liste di carico senza cantiere in FORNITORI/NISTA = sotto Nista.
- Se non può salvare (cartella non chiara, mail non trovata) scrive una riga visibile "Mail non salvata".
- In G&C le righe delle mail non si vedono per 3 giorni; dopo, se ancora aperte (spostate da Thunderbird/telefono o rimaste in casella), compaiono in Da controllare (migrazione G&C 172).
