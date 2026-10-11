# Componenti estraibili

## BarraAree
- Source: `src/App.jsx` (header .barra)
- Category: layout
- Description: barra in alto con interruttore Tutte/C/G/P e tasto Dentro con badge Inbox
- Extractable props: areaAttiva (string, default: "T"), inbox (number, default: 0)
- Hardcoded: colori delle aree, icona Dentro

## TastiInBasso
- Source: `src/App.jsx` (nav .tasti)
- Category: layout
- Description: barra in basso con Oggi, Aggiungi (grande al centro), Chiedi
- Extractable props: attivo (string, default: "oggi")
- Hardcoded: icone, etichette

## NotaRiga
- Source: `src/componenti.jsx`
- Category: basic
- Description: riga nota con pallino area, testo e data
- Extractable props: nessuna
- Hardcoded: stile riga
