// Scrive i file di contesto per Superdesign in .superdesign/init/ (codice vero dell'app).
// Uso: node scripts/superdesign-init.mjs
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs'

const leggi = (p) => readFileSync(p, 'utf8')
const blocco = (p, lang = 'jsx') => `### \`${p}\`\n\n\`\`\`${lang}\n${leggi(p).trimEnd()}\n\`\`\`\n`
mkdirSync('.superdesign/init', { recursive: true })

writeFileSync('.superdesign/init/components.md', `# Componenti condivisi

App: React 19 + Vite 8, JavaScript (JSX), CSS semplice (nessun Tailwind, nessuna libreria UI).
Tutti i componenti condivisi stanno in un solo file. Icone: SVG a tratto fatte a mano (componente \`Icona\`).

- \`Icona\`: icone SVG a tratto (oggi, piu, cerca, dentro, indietro, mic, foto, campana, x, freccia)
- \`Indietro\`: testata con freccia indietro e titolo
- \`Stato\`: messaggi di caricamento / errore / vuoto
- \`SceltaArea\`: chip per scegliere Inbox / Ceramex / G&C / Privato
- \`SceltaPersone\`: ricerca persone con tendina
- \`NotaRiga\`: riga di una nota (pallino area, testo su 2 righe, data)

${blocco('src/componenti.jsx')}`)

writeFileSync('.superdesign/init/layouts.md', `# Layout

Guscio unico dell'app (\`Guscio\` in App.jsx): barra in alto con interruttore aree (Tutte, C, G, P) e tasto "Dentro";
contenuto al centro; barra in basso fissa con 3 tasti (Oggi, Aggiungi al centro e grande, Chiedi). App mobile (PWA Android).

${blocco('src/App.jsx')}
${blocco('index.html', 'html')}`)

writeFileSync('.superdesign/init/routes.md', `# Rotte

Routing con hash, configurato nello switch di \`src/App.jsx\` (vedi layouts.md).

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
`)

const css = leggi('src/stile.css')
writeFileSync('.superdesign/init/theme.md', `# Tema

## Parte 1 — Riassunto token

- Sfondo #f6f5f2, superficie #ffffff, testo #1c1917, tenue #78716c, bordo #e7e5e4, scuro #1c1917, grigio #a8a29e, rosso #dc2626
- Colori fissi delle aree: Ceramex (C) #2563eb blu, G&C (G) #16a34a verde, Privato (P) #ea580c arancio
- Font: system-ui 16px/1.45; h1 22px; h2 13px maiuscolo spaziato grigio
- Raggio 14px; barra alta 60px; barra tasti 68px
- Solo tema chiaro, niente ombre di rilievo, niente animazioni

## Parte 2 — CSS completo

\`\`\`css
${css.trimEnd()}
\`\`\`
`)

writeFileSync('.superdesign/init/pages.md', `# Pagine e dipendenze

## #/oggi (Oggi)
Entry: src/Oggi.jsx
Dependencies:
- src/supabase.js
- src/componenti.jsx
- src/stile.css
- src/App.jsx (guscio)

## #/azienda/:id (Scheda azienda)
Entry: src/Aziende.jsx
Dependencies:
- src/supabase.js
- src/componenti.jsx
- src/stile.css

## #/aggiungi (Aggiungi)
Entry: src/Aggiungi.jsx
Dependencies:
- src/supabase.js
- src/componenti.jsx

## #/persone (Persone)
Entry: src/Persone.jsx
Dependencies:
- src/supabase.js
- src/componenti.jsx

## #/nota/:id (Nota)
Entry: src/Nota.jsx
Dependencies:
- src/supabase.js
- src/componenti.jsx
- src/Aziende.jsx
`)

writeFileSync('.superdesign/init/extractable-components.md', `# Componenti estraibili

## BarraAree
- Source: \`src/App.jsx\` (header .barra)
- Category: layout
- Description: barra in alto con interruttore Tutte/C/G/P e tasto Dentro con badge Inbox
- Extractable props: areaAttiva (string, default: "T"), inbox (number, default: 0)
- Hardcoded: colori delle aree, icona Dentro

## TastiInBasso
- Source: \`src/App.jsx\` (nav .tasti)
- Category: layout
- Description: barra in basso con Oggi, Aggiungi (grande al centro), Chiedi
- Extractable props: attivo (string, default: "oggi")
- Hardcoded: icone, etichette

## NotaRiga
- Source: \`src/componenti.jsx\`
- Category: basic
- Description: riga nota con pallino area, testo e data
- Extractable props: nessuna
- Hardcoded: stile riga
`)
console.log('ok')
