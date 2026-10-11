# Rotte

Routing con hash, configurato nello switch di `src/App.jsx` (vedi layouts.md).

| Hash | File | Cosa mostra |
| --- | --- | --- |
| #/oggi (predefinita) | src/Oggi.jsx | Data, avvisi, promemoria raggruppati (in ritardo, oggi, prossimi, senza data), ultime note |
| #/aggiungi | src/Aggiungi.jsx | Scrivi, detta, foto, area, persone, ricordamelo |
| #/chiedi | src/Chiedi.jsx | Ricerca nelle note |
| #/dentro | src/Dentro.jsx | Menu: Inbox, Aziende, Persone, Tutte le note, Cestino |
| #/inbox, #/note, #/cestino | src/Dentro.jsx | Elenchi |
| #/aziende, #/azienda/:id | src/Aziende.jsx | Schede clienti Ceramex con note per mandante e sezione |
| #/persone, #/persona/:id | src/Persone.jsx | Diagramma a cerchi delle persone per area, scheda persona |
| #/nota/:id | src/Nota.jsx | Dettaglio e modifica nota |
