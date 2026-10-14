# Calendario

Agente calendario, Google Calendar, spostare appuntamenti, inviti a call, appunti di visita. Testo spostato così com'era da CLAUDE.md il 14.10.2026 (versione intera nel tag git `prima-divisione-claude-md`).

### Calendario e promemoria (fase 3)
- All'inizio gli eventi si creano solo con la conferma di Giovanni. Più avanti anche in automatico.
- Le date trovate in mail e WhatsApp vengono proposte con un tocco.
- Prima di un appuntamento con un cliente: il suo riassunto. Dopo: "cosa vuoi annotare?".
- I promemoria stanno nell'app. Le notifiche sul telefono solo per le cose urgenti che sceglie Giovanni (fatte il 13.10.2026, vedi "Vacanze scolastiche, liste, garanzie, notifiche").
- Riassunti: mattino, sera, domenica sera.

### Calendario (fase 3, 12.10.2026 notte)
- Routine "Agente calendario" `trig_01ExFtoP2zGTkQDT4mnTdzGD` (:05, 6–22), connettore Google Calendar dell'account claude.ai di Giovanni (unico connettore), utente DB `agente_calendario` (solo `eventi` + nomi di ditte/persone). Regole: `agenti/agente-calendario.md`.
- Copia gli eventi di giovannifabris@ceramex.ch (da 2 giorni fa a 45 avanti) in `eventi` con area, ditta e persona. Crea in Google SOLO gli eventi approvati da Giovanni nell'app (stato 'da_creare'), senza invitati. Non cancella niente in Google; sposta/corregge SOLO quello che Giovanni cambia nell'app (vedi sotto).
- **Spostare un appuntamento (12.10.2026):** in Oggi tocco sull'appuntamento → pannello con scheda, persona, appunti e titolo/inizio/fine/luogo + "Rimanda a" (domani, lunedì, una settimana dopo), con Annulla; anche dalla pagina dell'appuntamento ("Sposta o cambia"). Per gli eventi Google l'app scrive `eventi.cambio` (jsonb) e lo mostra subito; l'agente calendario (punto 0) fa update_event sullo STESSO evento, poi copia i valori e svuota `cambio`. Eventi con invitati o di altri: non li tocca (errore "Ha degli invitati: spostalo da Google Calendar"). Stesso id = appunti, note e collegamenti restano. Se qualcuno lo sposta in Google, la copia aggiorna la stessa riga.
- Oggi: appuntamenti di oggi e dei prossimi 7 giorni (tocco = scheda persona/ditta prima della visita; dopo l'appuntamento = "Annota" con la persona già collegata), proposte "Da mettere in calendario? Sì/No", punto del mattino/sera, compleanni (14 giorni).
- Un solo calendario Google (scelta di Giovanni, 12.10.2026): l'area si vede dal **colore**, messo in automatico dall'agente (C mirtillo 9, G basilico 10, P mandarino 6, sempre senza notifiche). In `eventi.colore` resta il colore messo dall'agente: se Giovanni ne cambia uno a mano in Google, l'agente non lo tocca più.

### Inviti a call nelle mail (14.10.2026, chiesto dal Capo, ok di Giovanni)
- `posta-gc` legge anche la parte calendario delle mail di info@ (text/calendar, .ics) e la salva in `posta.invito` (metodo, titolo, inizio/fine in UTC, link più corto, organizzatore; i fusi Outlook tipo "W. Europe Standard Time" sono tradotti). `{ "inviti_giorni": N }` rilegge gli inviti di INBOX degli ultimi N giorni (fatto una volta il 14.10).
- Agente G&C (punto 3 b2, 2 routine) e agente Ceramex (PASSO 2d, 3 routine): invito a una call → appuntamento `eventi` 'proposto' con il link nella descrizione, niente bozza. **L'archiviazione nel Riordino resta come sempre** (Giovanni, 14.10). Prima controllano `call_gia_in_calendario()` (risponde solo sì/no, vede tutte le aree); `eventi.da_mail` è unico, così una mail dà una proposta sola. Migrazione `inviti_call` (agente_gc/agente_ceramex: select+insert 'proposto' nella loro area; agente_ceramex può fare domande area C).
- Agente calendario: crea l'evento con `eventi.descrizione` per prima (link, ID, passcode), poi "Dal second brain: motivo".
- Oggi: "Entra nella call" in "Adesso" e nel pannello dell'appuntamento, "Link della call" nelle proposte (`linkCall` in `Visita.jsx`); niente "Naviga" se il luogo è Teams/Zoom/Meet.
- Prima prova: la call Redsun «Abstimmung Zusammenarbeit» di venerdì 16.10 alle 9 (proposta dal Capo, approvata da Giovanni).

### Appunti durante un appuntamento (12.10.2026)
- `#/visita/<id evento>` (`src/Visita.jsx`): tasto "Appunti" sugli appuntamenti di lavoro di oggi in Oggi (e tocco su un appuntamento senza ditta/persona). Testo salvato sul telefono (localStorage `visita:<id>`) mentre scrivi; se manca la ditta propone quelle col nome nel titolo. "Fine visita" → una nota "Appunti visita «…» del …" con ditta e persona, l'appuntamento diventa fatto. L'agente lavoro (punto 3f) crea le note brevi per sezione. Oggi avvisa se ci sono appunti non finiti.
- `domande.mostra_dal`: una domanda si vede solo da quell'ora (es. gemelli alle 20 del 12.10).

### Agente calendario: ditte nei titoli (12.10.2026 pomeriggio)

- Agente calendario: riconosce le ditte anche nei titoli scritti di corsa ("creaceram" = Crea Ceram), sceglie quella dell'area e la capogruppo, e ricontrolla gli eventi C/G senza ditta (punto 1b). Agente lavoro: se la nota ha già la ditta (scelta da Giovanni) la tiene.

Vedi anche: `privato-gemelli.md` (vacanze "Scuola chiusa", pianoforte), `schermate.md` (Oggi a lista unica, spunta sugli appuntamenti).
