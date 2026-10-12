# Richiesta "Analisi dell'app" a Meta (WhatsApp)

Scopo: ottenere l'accesso avanzato a `whatsapp_business_messaging` e `whatsapp_business_management`.
Senza, l'iscrizione integrata non offre l'aggancio del numero WhatsApp Business che Giovanni usa già (coesistenza).

Bozza della richiesta su Meta: App "Second Brain GF" → Analisi → Analisi dell'app (non inviata, si salva da sola).
I testi vanno in inglese: chi controlla lavora in inglese. L'app è in italiano, quindi ogni passo del video è spiegato qui sotto.

## Stato (13.10.2026 notte): INVIATA da Giovanni, "Analisi in corso" (Meta: di solito entro 20 giorni)

Si controlla su developers.facebook.com → app Second Brain GF → Analisi → Analisi dell'app. Meta avvisa anche per email/notifica.

## Stato precedente (12.10.2026, 09:45)

- Fatto: numero di prova collegato, messaggio ricevuto e mandato dall'app ("consegnato"), modello `conferma_appuntamento` creato. Due video registrati (originali in `Video\Registrazioni dello schermo\Meta video 1 - messaggi.mp4` e `Meta video 2 - modelli.mp4`, caricati compressi).
- Compilati e salvati su Meta: Verifica, Impostazioni app (icona, piattaforma Sito web), Utilizzo consentito (testi, video, conformità spuntata con l'ok di Giovanni), Gestione dei dati, Istruzioni per chi controlla.
- Manca solo che Meta conti le chiamate di prova ("0 di 1", fino a 24 ore). Poi **Invia per l'analisi**, solo con un secondo ok di Giovanni.

## Prima del video: numero di prova di Meta (gratis)

- Numero di prova: +1 555 645 6202
- Phone Number ID: `1294186367119756`
- WhatsApp Business Account ID: `1132628449338035`
- Collegamento: `node scripts/whatsapp-prova.mjs 1132628449338035 1294186367119756` (il token temporaneo va prima copiato negli appunti; dura 24 ore).
- Il numero vero si collega dopo l'approvazione e sostituisce quello di prova.

## Descrizione dell'azienda (una riga)

> Ceramex SAGL is a Swiss sales agency for ceramic tiles and interior finishes; we use our own internal app to manage conversations with our customers and suppliers.

## whatsapp_business_messaging: come la usa l'app

> Second Brain GF is a private, internal business app used only by the owner of Ceramex SAGL (Switzerland) to run his own business. It connects the company's own WhatsApp Business number (onboarded via Embedded Signup with WhatsApp Business app coexistence, so the owner keeps using the WhatsApp Business app on his phone).
>
> We use whatsapp_business_messaging to:
> 1. receive the messages our customers and suppliers send to our number (webhook), so they are stored in our private database and linked to the right customer record;
> 2. let the owner reply from the app to a customer who wrote to us in the last 24 hours (free-form text message, sent only after the owner taps "Send" twice);
> 3. receive message status updates (sent, delivered, read).
>
> We never send unsolicited or bulk messages, and no message is sent automatically: every outgoing message is written or approved by the owner. The app is not offered to other businesses.

## whatsapp_business_management: come la usa l'app

> We use whatsapp_business_management only for our own WhatsApp Business account:
> 1. to subscribe our app to our WhatsApp Business account webhooks and read the phone number details (display number, verified name) after onboarding;
> 2. to create and list message templates (e.g. an appointment confirmation) from the app's "Message templates" screen, so the owner can contact a customer outside the 24-hour window with an approved template;
> 3. after coexistence onboarding, to request the one-time sync of contacts and message history of our own number.
>
> We do not manage WhatsApp accounts of other businesses.

## public_profile

Solo accettare la conformità (serve al login di Facebook per l'iscrizione integrata).

## Video 1: messaggi (whatsapp_business_messaging), circa 1-2 minuti

Registrazione dello schermo del PC: tasti **Windows + Maiusc + R** (Strumento di cattura) → scegli tutto lo schermo → Avvia.
A sinistra l'app Second Brain, a destra WhatsApp Web del telefono (così si vede il messaggio arrivare).

1. In WhatsApp Web: scrivi "Hello" al numero di prova +1 555 645 6202.
2. Nell'app: menu → WhatsApp. La chat nuova compare in alto. Aprila: si vede "Hello".
3. Scrivi "Hello from Second Brain, your order is confirmed" → **Manda** → **Tocca ancora per mandare**.
4. In WhatsApp Web il messaggio arriva. Torna nell'app: sotto il messaggio compare "consegnato" o "letto".

Testo da mettere sotto il video (inglese):

> The app UI is in Italian. 0:00 the customer (our test phone, WhatsApp Web on the right) writes to our business number. 0:15 the message arrives in our app (menu "WhatsApp" = chats). 0:30 the owner types a reply and taps "Manda" (Send) twice to confirm. 0:45 the reply is delivered on WhatsApp; the status in the app changes to "consegnato" (delivered) / "letto" (read).

## Video 2: modelli (whatsapp_business_management), circa 1 minuto

1. Nell'app: menu → WhatsApp → **Modelli di messaggio**.
2. Nome: `conferma appuntamento`; categoria: **Servizio**; testo: `Buongiorno {{1}}, le confermo l'appuntamento di {{2}} alle {{3}}. Giovanni Fabris`.
3. **Crea modello** → **Tocca ancora per mandarlo a Meta**.
4. Il modello compare nell'elenco "in controllo da Meta" (poi "approvato").
5. Facoltativo: apri WhatsApp Manager → Modelli e mostra lo stesso modello.

Testo da mettere sotto il video (inglese):

> The app UI is in Italian. 0:00 the owner opens "Modelli di messaggio" (Message templates). 0:10 he writes a utility template (appointment confirmation with variables) and taps "Crea modello" (Create template) twice. 0:30 the app calls the WhatsApp Business Management API (POST /{waba_id}/message_templates) and lists our templates with their review status ("in controllo da Meta" = pending, "approvato" = approved). 0:45 the same template in WhatsApp Manager.

## Gestione dei dati (risposte)

- Responsabili del trattamento / fornitori con accesso ai dati: **sì**.
  - Supabase (database e funzioni, server a Zurigo, Svizzera);
  - Cloudflare (pubblica l'app, non salva i messaggi);
  - Anthropic (assistente AI che riassume i messaggi solo per Giovanni).
- Entità responsabile: **Ceramex SAGL**, Svizzera.
- Richieste di autorità negli ultimi 12 mesi: **no**.
- Regole per le richieste delle autorità: controllo della legittimità della richiesta, minimizzazione dei dati, documentazione delle richieste.

## Istruzioni per chi controlla (inglese)

> Second Brain GF is a private internal tool of Ceramex SAGL. It has a single user (the company owner) and access is protected by a device passkey (fingerprint/face), so we cannot share login credentials. The two screencasts show the complete end-to-end flow for each permission, recorded with the WhatsApp test number of our app (+1 555 645 6202). In production the same flows run on our own WhatsApp Business number, onboarded through Embedded Signup with WhatsApp Business app coexistence. Privacy policy: https://second-brain.aged-king-4bbd.workers.dev/privacy.html

## Dopo l'approvazione

1. Iscrizione integrata con il QR, numero vero (scegliere "collega l'app WhatsApp Business", MAI numero nuovo o virtuale).
2. Chiamata a `whatsapp-collega` con code, waba_id, phone_number_id entro 24 ore: contatti e storico 6 mesi.
3. Cancellare (con l'ok di Giovanni) la chat di prova con il numero +1 555 645 6202.
