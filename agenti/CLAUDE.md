# Promemoria per la cartella agenti/

Valgono quando cambi le regole degli agenti. I dettagli stanno in `docs/agenti-routine.md`.

- Ogni file `agente-*.md` è la fonte unica delle regole di un agente. Il prompt della routine ne è una copia (per G&C un riassunto): se cambi un file, aggiorna anche la routine (o le routine) e scrivilo nel commit.
- Prima di cambiare una routine rileggila: Giovanni a volte la cambia parlando con lei.
- Aggiornare il prompt: get → `node scripts/routine-prompt.mjs estrai <risposta> <prompt.txt>` → modifica → update con il testo INTERO → `confronta` deve dire IDENTICO. I file col prompt contengono token: solo nella cartella temporanea, mai qui né su git.
- Nei file di questa cartella mai il token vero (si scrive `<TOKEN>`). Il Capo non ha token nel prompt: glielo aggiunge `agente-subito` al messaggio di avvio.
- Le 3 routine "Bozze mail Ceramex" non sono uguali: mezz'ora ha un PASSO 6 più vecchio e niente blocco RICHIESTE, weekend senza blocco RICHIESTE.
- Il blocco "RICHIESTE DI GIOVANNI" sta in fondo alle regole: calendario, lavoro, privato, G&C ore piene, Ceramex ore piene, archiviazione (blocco 00).
- Lavoro e Privato separati: gli agenti di lavoro non leggono il Privato; l'agente privato vede solo P.
- Posta: gli agenti leggono e propongono (anche il Cestino, solo come proposta). Nessuna mail si sposta, etichetta o cestina se Giovanni non l'ha scelta nell'app. Unica eccezione: le liste di carico.
- Gestionali: si leggono; scrivono solo le routine che lo facevano già, e solo nelle tabelle indicate nelle loro regole.
- Cose rischiose del Capo → `capo_conferme` (due tocchi di Giovanni).
- Niente mail o notifiche di prova. Una prova che fa partire un agente può mandare una notifica al telefono di Giovanni: farla di giorno e dirglielo prima.
- Routine create via API: passare sempre `mcp_connections`, se no prendono TUTTI i connettori dell'account.

| File | Routine |
| --- | --- |
| `agente-gc.md` | Agente G&C (ore piene) `trig_0167WFkRzohRBwGMJKA5PQCi`, (mezz'ora) `trig_01WUMfFZV9XKDSRTwH5HREoz` |
| `agente-note.md` | Agente note lavoro `trig_012xsQNDrzFNnpAszr9gsGBh` |
| `agente-privato.md` | Agente privato `trig_014BzqnSAWeuSq97vzQdwG15` |
| `agente-calendario.md` | Agente calendario `trig_01ExFtoP2zGTkQDT4mnTdzGD` |
| `agente-ceramex.md` | Bozze mail Ceramex: ore piene `trig_019Tg78tNtVBbxhjWoviuSXr`, mezz'ora `trig_01TZMc3zZgCSK1NAqsDwZfrA`, weekend `trig_01AASJEQ8NHJESnSiyb6pMty` |
| `agente-liste-carico.md` | Archivia liste di carico Ceramex `trig_01KsKntEhDqeUqBkfri43S5f` |
| `agente-riepilogo.md` | Cestina Riepilogo Ceramex `trig_013MZvzHbrRNeVLRt84pQSij` (IN PAUSA) |
| `agente-fornitori-gc.md` | Completa fornitori scontrini `trig_01FgTpFW71zzgUVUgmdURN4s` |
| `agente-archiviazione-gc.md` | Archiviazione email G&C `trig_01Go1LUFLhtADpTeZs2GjY8s` |
| `agente-smistatore.md` | Smistatore `trig_01EmGQxMLKmQgRjYHJw77p9L` |
| `agente-seguire.md` | Agente da seguire `trig_01DznF5caV1wjdxjt2bH1w2a` |
| `agente-capo.md` | Agente capo `trig_01Hv5Y9LHytXiiX5L3xs2Nuw` (parte solo dal pulsante) |
| `agente-ordini.md` | Ordini Marazzi `trig_01MZAj5mn8whEhDXom22181Y` |
