-- 14.10.2026 (ok di Giovanni): l'agente G&C chiede UNA volta cosa fare delle note del parcheggio "G&C" che non sa
-- dove mettere (prima le riguardava ogni ora). Vede e scrive solo le domande dell'area G fatte da lui; niente cancellazioni.
grant select, insert, update on public.domande to agente_gc;
drop policy if exists "agente gc" on public.domande;
create policy "agente gc" on public.domande for all to agente_gc
  using (area = 'G' and agente = 'gc') with check (area = 'G' and agente = 'gc');
