-- Agente Ceramex: le vendite G&C trovate nella Gmail Ceramex vanno nella scheda di parcheggio "G&C" dell'area G
-- (come faceva copia-ceramex con la vecchia scheda "G&C" del gestionale); poi l'agente G&C le smista.
-- Può solo aggiungere note lì e leggerle (per non fare doppioni), nient'altro dell'area G.
create policy "agente ceramex parcheggio G" on public.note for insert to agente_ceramex
  with check (area = 'G' and azienda_id = '823be55a-9f6b-4a48-b518-5f7d4f4c2081' and not da_ceramex);
create policy "agente ceramex parcheggio G legge" on public.note for select to agente_ceramex
  using (area = 'G' and azienda_id = '823be55a-9f6b-4a48-b518-5f7d4f4c2081');
