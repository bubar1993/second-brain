-- Volumi e spegnimento della musica delle sveglie (22.10.2026, scelte di Giovanni).
-- Camera Mia: voce 15, musica 5. Bambini: voce 20, musica 9. Musica in pausa dopo 5 minuti.
alter table public.sonos_sveglie
  add column musica_minuti smallint not null default 5 check (musica_minuti between 1 and 180),
  add column spegni_alle timestamptz,
  add column spegni_gruppo text,
  add column spegni_preferito text;
update public.sonos_sveglie set volume_voce = 15, volume_musica = 5 where cassa = 'Camera Mia';
update public.sonos_sveglie set volume_voce = 20, volume_musica = 9 where cassa = 'Bambini';

-- Ogni minuto: chiama la funzione se c'è una sveglia da fare o una musica da fermare.
select cron.schedule('sonos-sveglie', '* * * * *', $$
  select net.http_post(
    url := 'https://vgurncqvgulldolhetyr.supabase.co/functions/v1/sonos',
    headers := jsonb_build_object('Content-Type', 'application/json',
      'x-copia-token', (select decrypted_secret from vault.decrypted_secrets where name = 'copia_token')),
    body := '{"azione":"sveglie"}'::jsonb)
  where exists (select 1 from public.sonos_sveglie_da_fare())
     or exists (select 1 from public.sonos_sveglie where spegni_alle <= now())
$$);
