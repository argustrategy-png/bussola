-- Cache de nome de contato (cliente/fornecedor) por ID do ERP. A listagem de
-- contas do Bling só traz o ID do contato, não o nome — buscar o nome exige
-- uma chamada extra por contato (GET /contatos/{id}), então guardamos aqui pra
-- não repetir a busca a cada sincronização, só quando aparece um ID novo.
-- Rode uma vez no SQL Editor do Supabase. Idempotente — pode rodar de novo sem erro.

create table if not exists public.contatos_cache (
  id              uuid primary key default gen_random_uuid(),
  subscriber_id   uuid not null references public.subscribers(id) on delete cascade,
  provider        text not null,
  contato_erp_id  text not null,
  nome            text not null,
  atualizado_em   timestamptz default now(),
  unique (subscriber_id, provider, contato_erp_id)
);
alter table public.contatos_cache enable row level security;

drop policy if exists "contatos_cache_select_own" on public.contatos_cache;
create policy "contatos_cache_select_own" on public.contatos_cache
  for select using (auth.uid() = subscriber_id);

create index if not exists idx_contatos_cache_subscriber on public.contatos_cache(subscriber_id);
