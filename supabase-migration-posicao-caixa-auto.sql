-- Posição de caixa calculada automaticamente a partir das movimentações de
-- Caixas e Bancos do Bling (não existe endpoint de saldo pronto na API — só
-- histórico de lançamentos — então o saldo é obtido somando crédito menos
-- débito de cada conta). A sincronização é incremental e resumível:
-- `sync_estado` guarda o progresso de uma sincronização em andamento (útil
-- pra contas com muito histórico, que não cabem numa única execução de 60s),
-- e é apagada quando a sincronização termina.
--
-- Substitui o preenchimento manual anterior: a partir de agora só o backend
-- (service_role) grava em saldos_caixas — por isso as policies de
-- insert/update/delete do usuário são removidas, mantendo só a de leitura.
--
-- Rode uma vez no SQL Editor do Supabase. Idempotente — pode rodar de novo
-- sem erro.

alter table public.saldos_caixas
  add column if not exists provider text,
  add column if not exists conta_financeira_id text,
  add column if not exists ultima_data_sincronizada date;

create unique index if not exists idx_saldos_caixas_conta_unica
  on public.saldos_caixas(subscriber_id, provider, conta_financeira_id)
  where conta_financeira_id is not null;

drop policy if exists "saldos_caixas_insert_own" on public.saldos_caixas;
drop policy if exists "saldos_caixas_update_own" on public.saldos_caixas;
drop policy if exists "saldos_caixas_delete_own" on public.saldos_caixas;

create table if not exists public.sync_estado (
  subscriber_id uuid not null references public.subscribers(id) on delete cascade,
  provider      text not null,
  tipo          text not null,
  estado        jsonb not null,
  updated_at    timestamptz default now(),
  primary key (subscriber_id, provider, tipo)
);
alter table public.sync_estado enable row level security;
-- sem policy de select/insert pro usuário final: só o backend (service_role,
-- que ignora RLS) mexe nessa tabela — é estado interno de sincronização, não
-- dado pra exibir.
