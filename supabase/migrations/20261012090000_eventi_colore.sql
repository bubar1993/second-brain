-- Colori del calendario per area (12.10.2026, Giovanni: "un calendario unico, 3 colori se è automatico").
-- L'agente calendario mette il colore in Google (C mirtillo 9, G basilico 10, P mandarino 6) e si segna qui quale ha messo:
-- se in Google il colore è diverso da questo, l'ha cambiato Giovanni a mano e non si tocca più.
alter table public.eventi add column if not exists colore text;
comment on column public.eventi.colore is 'colorId messo dall''agente calendario in Google (9 C, 10 G, 6 P)';
