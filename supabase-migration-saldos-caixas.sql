-- Posição de caixa digitada manualmente (Caixas e Bancos do Bling não tem
-- saldo pela API — só histórico de movimentações). Guardado no banco, não
-- mais no navegador, pra qualquer um que acesse essa conta do MeuArgus ver
-- os mesmos números. Rode uma vez no SQL Editor do Supabase. Idempotente —
-- pode rodar de novo sem erro.

create table if not exists public.saldos_caixas (
  id             uuid primary key default gen_random_uuid(),
  subscriber_id  uuid not null references public.subscribers(id) on delete cascade,
  nome           text,
  moeda          text not null,
  valor          numeric not null,
  created_at     timestamptz default now(),
  updated_at     timestamptz default now()
);
alter table public.saldos_caixas enable row level security;

drop policy if exists "saldos_caixas_select_own" on public.saldos_caixas;
create policy "saldos_caixas_select_own" on public.saldos_caixas
  for select using (auth.uid() = subscriber_id);

drop policy if exists "saldos_caixas_insert_own" on public.saldos_caixas;
create policy "saldos_caixas_insert_own" on public.saldos_caixas
  for insert with check (auth.uid() = subscriber_id);

drop policy if exists "saldos_caixas_update_own" on public.saldos_caixas;
create policy "saldos_caixas_update_own" on public.saldos_caixas
  for update using (auth.uid() = subscriber_id);

drop policy if exists "saldos_caixas_delete_own" on public.saldos_caixas;
create policy "saldos_caixas_delete_own" on public.saldos_caixas
  for delete using (auth.uid() = subscriber_id);

create index if not exists idx_saldos_caixas_subscriber on public.saldos_caixas(subscriber_id);
