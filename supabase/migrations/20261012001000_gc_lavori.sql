-- Second Brain GF – Fase 5: lavori automatici G&C.
-- copia-gc ogni ora (clienti, cantieri, fornitori, mail salvate nel gestionale G&C),
-- posta-gc ogni 5 minuti (casella info@ via IMAP), annullo delle bozze superate.

-- A che punto è la lettura di ogni cartella della casella.
create table public.posta_stato (
  cartella      text primary key,
  uidvalidity   bigint,
  ultimo_uid    bigint not null default 0,   -- mail nuove: dopo questo uid
  storico_uid   bigint,                      -- storico: già letto fino a qui (scendendo); 0 = finito
  modificata_il timestamptz not null default now()
);
alter table public.posta_stato enable row level security;
revoke all on public.posta_stato from anon, authenticated;

-- Conversazioni: una risposta prende il thread della mail a cui risponde, se la conosciamo.
create or replace function public.posta_allinea_thread() returns integer
language plpgsql security definer set search_path = public as $$
declare n integer := 0; m integer;
begin
  loop
    update posta p set thread_key = q.thread_key
      from posta q
     where q.message_id = coalesce(p.in_reply_to, p.riferimenti[array_length(p.riferimenti, 1)])
       and q.thread_key is not null and p.thread_key is distinct from q.thread_key
       and q.id <> p.id;
    get diagnostics m = row_count;
    n := n + m;
    exit when m = 0 or n > 5000;
  end loop;
  return n;
end $$;

-- Bozze superate: nella stessa conversazione è arrivata o partita una mail dopo la bozza.
create or replace function public.annulla_bozze_superate() returns integer
language plpgsql security definer set search_path = public as $$
declare n integer;
begin
  update bozze b set stato = 'annullata', annullata_il = now(),
         motivo_annullata = case when p.cartella = 'inviata'
           then 'Qualcuno ha già risposto da info@ (' || to_char(p.data at time zone 'Europe/Zurich', 'DD.MM HH24:MI') || ')'
           else 'È arrivata una mail nuova nella conversazione (' || to_char(p.data at time zone 'Europe/Zurich', 'DD.MM HH24:MI') || ')' end
    from lateral (
      select q.cartella, q.data from posta q
       where q.thread_key = b.thread_key
         and q.data > b.creata_il
         and q.message_id is distinct from b.inviata_message_id
         and (b.posta_id is null or q.id <> b.posta_id)
       order by q.data limit 1) p
   where b.stato = 'proposta' and b.thread_key is not null;
  get diagnostics n = row_count;
  return n;
end $$;
revoke execute on function public.posta_allinea_thread(), public.annulla_bozze_superate() from public, anon, authenticated;

-- Copia dal gestionale G&C ogni ora (5 minuti dopo l'ora) e posta ogni 5 minuti.
select cron.schedule('copia-gc', '5 * * * *', $$
  select net.http_post(
    url := 'https://vgurncqvgulldolhetyr.supabase.co/functions/v1/copia-gc',
    headers := jsonb_build_object('Content-Type', 'application/json',
      'x-copia-token', (select decrypted_secret from vault.decrypted_secrets where name = 'copia_token')),
    body := '{}'::jsonb, timeout_milliseconds := 120000)
$$);
select cron.schedule('posta-gc', '*/5 * * * *', $$
  select net.http_post(
    url := 'https://vgurncqvgulldolhetyr.supabase.co/functions/v1/posta-gc',
    headers := jsonb_build_object('Content-Type', 'application/json',
      'x-copia-token', (select decrypted_secret from vault.decrypted_secrets where name = 'copia_token')),
    body := '{}'::jsonb, timeout_milliseconds := 120000)
$$);
