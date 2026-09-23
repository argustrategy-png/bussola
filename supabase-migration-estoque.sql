-- Migração pra guardar posição de estoque e itens de venda sincronizados do
-- ERP (hoje só Bling implementa isso). Rode uma vez no SQL Editor do
-- Supabase. Idempotente — pode rodar de novo sem erro.

create table if not exists public.produtos (
  id             uuid primary key default gen_random_uuid(),
  subscriber_id  uuid not null references public.subscribers(id) on delete cascade,
  erp_id         text not null,
  provider       text not null,
  nome           text not null,
  codigo         text,
  preco          numeric,
  estoque_atual  numeric,
  situacao       text,
  updated_at     timestamptz default now(),
  unique (subscriber_id, provider, erp_id)
);
alter table public.produtos enable row level security;

drop policy if exists "produtos_select_own" on public.produtos;
create policy "produtos_select_own" on public.produtos
  for select using (auth.uid() = subscriber_id);

create index if not exists idx_produtos_subscriber on public.produtos(subscriber_id);

-- Um item vendido por pedido/fatura — a granularidade que permite calcular
-- "mais vendido" por quantidade ou por valor. Não referencia `lancamentos`
-- porque um pedido de venda pode virar 1 conta a receber (não 1 por item).
create table if not exists public.vendas_itens (
  id             uuid primary key default gen_random_uuid(),
  subscriber_id  uuid not null references public.subscribers(id) on delete cascade,
  provider       text not null,
  pedido_erp_id  text not null,
  produto_erp_id text,
  produto_nome   text not null,
  quantidade     numeric not null,
  valor          numeric not null,
  data           date not null,
  created_at     timestamptz default now(),
  unique (subscriber_id, provider, pedido_erp_id, produto_erp_id)
);
alter table public.vendas_itens enable row level security;

drop policy if exists "vendas_itens_select_own" on public.vendas_itens;
create policy "vendas_itens_select_own" on public.vendas_itens
  for select using (auth.uid() = subscriber_id);

create index if not exists idx_vendas_itens_subscriber on public.vendas_itens(subscriber_id);
create index if not exists idx_vendas_itens_data on public.vendas_itens(data);
