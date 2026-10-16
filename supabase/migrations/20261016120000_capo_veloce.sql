-- Risposta veloce del Capo (16.10.2026, ok di Giovanni): le domande semplici le risponde subito capo-veloce
-- con i crediti API (Sonnet + strumenti di sola lettura); il resto passa alla routine del Capo come prima.
-- veloce: null = mai passata da capo-veloce; true = ha risposto capo-veloce; false = capo-veloce l'ha passata al Capo.
alter table public.richieste_agenti add column if not exists veloce boolean;

-- La spesa del Capo veloce va in ai_uso come quella di Chiedi (stessi tetti del mese).
alter table public.ai_uso add column if not exists richiesta_id uuid references public.richieste_agenti on delete set null;
