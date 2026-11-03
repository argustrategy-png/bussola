-- Módulo de Precificação (insumos, receitas/fichas técnicas, preços salvos).
-- Rode no SQL Editor do Supabase DEPOIS da supabase-migration-paywall.sql
-- (usa public.assinatura_ativa()). Idempotente.
--
-- Liberado por cliente, só pelo admin (tabela modulos_assinante). Desligar
-- esconde a página mas não apaga nada. Receitas e custos são dados
-- comerciais sigilosos do assinante: toda tabela pr_* só é visível para o
-- próprio dono, com o módulo ligado e assinatura ativa.

-- ── 1. Chave do módulo, controlada pelo admin ──────────────────────────
create table if not exists public.modulos_assinante (
  subscriber_id  uuid primary key references public.subscribers(id) on delete cascade,
  precificacao   boolean not null default false,
  updated_at     timestamptz default now()
);
alter table public.modulos_assinante enable row level security;

drop policy if exists "modulos_select_own_or_admin" on public.modulos_assinante;
create policy "modulos_select_own_or_admin" on public.modulos_assinante
  for select using (auth.uid() = subscriber_id or public.is_admin());

-- Só admin grava. Não existe policy de escrita para o usuário comum.
drop policy if exists "modulos_write_admin" on public.modulos_assinante;
create policy "modulos_write_admin" on public.modulos_assinante
  for all using (public.is_admin()) with check (public.is_admin());

create or replace function public.precificacao_ativa()
returns boolean
language sql
stable
security definer set search_path = public
as $$
  select public.is_admin()
      or (public.assinatura_ativa()
          and coalesce((select m.precificacao from public.modulos_assinante m where m.subscriber_id = auth.uid()), false));
$$;

-- ── 2. Insumos e histórico de preço ────────────────────────────────────
-- Custo por unidade de uso = preco / (conteudo * aproveitamento / 100).
-- Ex.: leite, caixa com 12000 ml por R$ 54,00, aproveitamento 100%.
create table if not exists public.pr_insumos (
  id              uuid primary key default gen_random_uuid(),
  subscriber_id   uuid not null references public.subscribers(id) on delete cascade,
  nome            text not null,
  unidade         text not null default 'g' check (unidade in ('g', 'ml', 'un')),
  conteudo        numeric not null check (conteudo > 0),
  preco           numeric not null check (preco >= 0),
  aproveitamento  numeric not null default 100 check (aproveitamento > 0 and aproveitamento <= 100),
  fornecedor      text,
  atualizado_em   timestamptz not null default now(),
  created_at      timestamptz default now()
);
create index if not exists idx_pr_insumos_sub on public.pr_insumos(subscriber_id);

-- origem: 'manual' hoje; 'nf' quando as notas de entrada do Bling entrarem.
create table if not exists public.pr_insumo_precos (
  id             uuid primary key default gen_random_uuid(),
  subscriber_id  uuid not null references public.subscribers(id) on delete cascade,
  insumo_id      uuid not null references public.pr_insumos(id) on delete cascade,
  preco          numeric not null,
  conteudo       numeric not null,
  origem         text not null default 'manual' check (origem in ('manual', 'nf', 'importacao')),
  data           timestamptz not null default now()
);
create index if not exists idx_pr_insumo_precos_insumo on public.pr_insumo_precos(insumo_id, data);

-- Grava o histórico sozinho a cada insumo novo ou mudança de preço/conteúdo.
create or replace function public.pr_insumos_historico()
returns trigger
language plpgsql
security definer set search_path = public
as $$
begin
  if tg_op = 'INSERT' or new.preco is distinct from old.preco or new.conteudo is distinct from old.conteudo then
    new.atualizado_em := now();
    insert into public.pr_insumo_precos (subscriber_id, insumo_id, preco, conteudo, origem)
    values (new.subscriber_id, new.id, new.preco, new.conteudo,
            coalesce(nullif(current_setting('precificacao.origem', true), ''), 'manual'));
  end if;
  return new;
end;
$$;
drop trigger if exists pr_insumos_historico on public.pr_insumos;
create trigger pr_insumos_historico
  after insert on public.pr_insumos
  for each row execute function public.pr_insumos_historico();
drop trigger if exists pr_insumos_historico_upd on public.pr_insumos;
create trigger pr_insumos_historico_upd
  before update on public.pr_insumos
  for each row execute function public.pr_insumos_historico();

-- ── 3. Receitas (fichas técnicas) ──────────────────────────────────────
create table if not exists public.pr_receitas (
  id             uuid primary key default gen_random_uuid(),
  subscriber_id  uuid not null references public.subscribers(id) on delete cascade,
  nome           text not null,
  rendimento     numeric not null check (rendimento > 0),
  unidade        text not null default 'litro',
  obs            text,
  created_at     timestamptz default now(),
  updated_at     timestamptz default now()
);
create index if not exists idx_pr_receitas_sub on public.pr_receitas(subscriber_id);

create table if not exists public.pr_receita_itens (
  id             uuid primary key default gen_random_uuid(),
  subscriber_id  uuid not null references public.subscribers(id) on delete cascade,
  receita_id     uuid not null references public.pr_receitas(id) on delete cascade,
  insumo_id      uuid not null references public.pr_insumos(id) on delete restrict,
  quantidade     numeric not null check (quantidade > 0)
);
create index if not exists idx_pr_receita_itens_receita on public.pr_receita_itens(receita_id);

-- ── 4. Configuração (custo de fábrica / despesas fixas) e preços salvos ─
create table if not exists public.pr_config (
  subscriber_id  uuid primary key references public.subscribers(id) on delete cascade,
  dados          jsonb not null default '{}',
  updated_at     timestamptz default now()
);

-- custo/preço/margem "congelados" no momento em que o preço foi definido —
-- é a referência para mostrar a margem caindo quando os insumos sobem.
create table if not exists public.pr_produtos (
  id                 uuid primary key default gen_random_uuid(),
  subscriber_id      uuid not null references public.subscribers(id) on delete cascade,
  nome               text not null,
  receita_id         uuid references public.pr_receitas(id) on delete set null,
  dados              jsonb not null default '{}',
  custo_precificado  numeric,
  preco_precificado  numeric,
  margem_precificada numeric,
  precificado_em     timestamptz default now(),
  updated_at         timestamptz default now()
);
create index if not exists idx_pr_produtos_sub on public.pr_produtos(subscriber_id);

-- ── 5. RLS: só o dono, com o módulo ligado ─────────────────────────────
do $$
declare t text;
begin
  foreach t in array array['pr_insumos', 'pr_insumo_precos', 'pr_receitas', 'pr_receita_itens', 'pr_config', 'pr_produtos'] loop
    execute format('alter table public.%I enable row level security', t);
    execute format('drop policy if exists "%s_own" on public.%I', t, t);
    execute format('create policy "%s_own" on public.%I for all
                    using (auth.uid() = subscriber_id and public.precificacao_ativa())
                    with check (auth.uid() = subscriber_id and public.precificacao_ativa())', t, t);
  end loop;
end $$;

-- Itens de receita só podem apontar para receita e insumo do mesmo dono.
create or replace function public.pr_receita_itens_mesmo_dono()
returns trigger
language plpgsql
security definer set search_path = public
as $$
begin
  if not exists (select 1 from public.pr_receitas r where r.id = new.receita_id and r.subscriber_id = new.subscriber_id)
     or not exists (select 1 from public.pr_insumos i where i.id = new.insumo_id and i.subscriber_id = new.subscriber_id) then
    raise exception 'Receita e insumo precisam ser da mesma conta.' using errcode = '42501';
  end if;
  return new;
end;
$$;
drop trigger if exists pr_receita_itens_mesmo_dono on public.pr_receita_itens;
create trigger pr_receita_itens_mesmo_dono
  before insert or update on public.pr_receita_itens
  for each row execute function public.pr_receita_itens_mesmo_dono();

-- Conferência: 7 tabelas com RLS ligado.
select relname as tabela, relrowsecurity as rls_ligado
from pg_class
where relnamespace = 'public'::regnamespace
  and relname in ('modulos_assinante', 'pr_insumos', 'pr_insumo_precos', 'pr_receitas', 'pr_receita_itens', 'pr_config', 'pr_produtos')
order by relname;
