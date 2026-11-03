-- Paywall no banco. Rode no SQL Editor do Supabase. Idempotente.
--
-- Até aqui o bloqueio de quem não pagou era só na tela (showPaywall em
-- index.html): com o teste grátis vencido, dava pra ler e gravar os próprios
-- lançamentos direto pela API do Supabase. Agora as tabelas de dados do
-- assinante só respondem se public.assinatura_ativa() for verdadeira.
-- Os dados não são apagados: voltam a aparecer quando a assinatura volta.
--
-- Também corrige um deslize da supabase-migration-seguranca.sql: ela recriou
-- "saldos_caixas_update_own", que a supabase-migration-posicao-caixa-auto.sql
-- tinha removido de propósito (só o backend grava saldos_caixas).

-- Admin, assinatura ativa (inclui past_due, ver api/stripe/webhook.js) ou
-- teste grátis dentro do prazo. A data do teste é comparada no fuso de
-- Brasília, igual ao app (index.html, onAuthed) — em UTC o prazo acabaria
-- 3h antes do que a tela mostra.
create or replace function public.assinatura_ativa()
returns boolean
language sql
stable
security definer set search_path = public
as $$
  select coalesce((
    select s.is_admin
        or s.status = 'ativo'
        or (s.status = 'trial' and s.expira >= (now() at time zone 'America/Sao_Paulo')::date)
    from public.subscribers s
    where s.id = auth.uid()
  ), false);
$$;

-- ── lancamentos ────────────────────────────────────────────────────────
drop policy if exists "lancamentos_select_own" on public.lancamentos;
create policy "lancamentos_select_own" on public.lancamentos
  for select using (auth.uid() = subscriber_id and public.assinatura_ativa());

drop policy if exists "lancamentos_insert_own" on public.lancamentos;
create policy "lancamentos_insert_own" on public.lancamentos
  for insert with check (auth.uid() = subscriber_id and public.assinatura_ativa());

drop policy if exists "lancamentos_update_own" on public.lancamentos;
create policy "lancamentos_update_own" on public.lancamentos
  for update using (auth.uid() = subscriber_id and public.assinatura_ativa())
  with check (auth.uid() = subscriber_id and public.assinatura_ativa());

drop policy if exists "lancamentos_delete_own" on public.lancamentos;
create policy "lancamentos_delete_own" on public.lancamentos
  for delete using (auth.uid() = subscriber_id and public.assinatura_ativa());

-- ── tabelas só de leitura pro usuário (o backend grava) ────────────────
drop policy if exists "saldos_caixas_update_own" on public.saldos_caixas;
drop policy if exists "saldos_caixas_select_own" on public.saldos_caixas;
create policy "saldos_caixas_select_own" on public.saldos_caixas
  for select using (auth.uid() = subscriber_id and public.assinatura_ativa());

drop policy if exists "produtos_select_own" on public.produtos;
create policy "produtos_select_own" on public.produtos
  for select using (auth.uid() = subscriber_id and public.assinatura_ativa());

drop policy if exists "vendas_itens_select_own" on public.vendas_itens;
create policy "vendas_itens_select_own" on public.vendas_itens
  for select using (auth.uid() = subscriber_id and public.assinatura_ativa());

drop policy if exists "contatos_cache_select_own" on public.contatos_cache;
create policy "contatos_cache_select_own" on public.contatos_cache
  for select using (auth.uid() = subscriber_id and public.assinatura_ativa());

-- Conferência: todas as linhas devem ter usa_paywall = true, e saldos_caixas
-- só deve aparecer com SELECT.
select tablename, policyname, cmd,
       coalesce(qual, '') || coalesce(with_check, '') like '%assinatura_ativa%' as usa_paywall
from pg_policies
where schemaname = 'public'
  and tablename in ('lancamentos', 'saldos_caixas', 'produtos', 'vendas_itens', 'contatos_cache')
order by tablename, cmd;
