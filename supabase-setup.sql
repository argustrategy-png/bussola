-- ============================================================
-- MEUARGUS — Supabase Schema v2 (com Auth + isolamento por assinante)
-- Cole este SQL no Supabase: SQL Editor → New Query → Run
--
-- Mudanças vs. v1:
--  - subscribers.id agora É o auth.users.id (perfil 1:1 com login)
--  - lancamentos ganha subscriber_id (cada assinante só vê os próprios)
--  - subscribers.is_admin marca quem pode acessar o admin.html
--  - trigger cria a linha em subscribers automaticamente no signup
--  - RLS de verdade: sem "using (true)" liberado pra qualquer um
-- ============================================================

-- ── 0. LIMPA SCHEMA ANTIGO (se existir) ──────────────────────
drop table if exists public.lancamentos cascade;
drop table if exists public.subscribers cascade;

-- ── 1. TABELA DE ASSINANTES (perfil ligado ao auth.users) ────
create table public.subscribers (
  id          uuid primary key references auth.users(id) on delete cascade,
  nome        text not null,
  email       text not null unique,
  tel         text,
  empresa     text,
  plano       text not null default 'free' check (plano in ('free','pro','premium')),
  status      text not null default 'trial' check (status in ('ativo','trial','inativo','expirado')),
  is_admin    boolean not null default false,
  cadastro    date default current_date,
  expira      date,
  ultimo_acesso date default current_date,
  obs         text,
  created_at  timestamptz default now()
);

-- ── 2. TABELA DE LANÇAMENTOS (Fluxo de Caixa, por assinante) ─
create table public.lancamentos (
  id            uuid primary key default gen_random_uuid(),
  subscriber_id uuid not null references public.subscribers(id) on delete cascade,
  tipo          text not null check (tipo in ('receber','pagar')),
  descricao     text not null,
  valor         numeric(12,2) not null,
  vencimento    date,
  categoria     text,
  status        text not null default 'pendente' check (status in ('pendente','pago')),
  recorrencia   text default 'none',
  toc           text default 'do',
  origem        text not null default 'manual' check (origem in ('manual','importado','erp')),
  contraparte   text,
  contraparte_telefone text,
  bling_id      text unique,
  created_at    timestamptz default now()
);

-- ── 3. AUTO-CRIA O PERFIL EM subscribers NO SIGNUP ───────────
create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer set search_path = public
as $$
begin
  insert into public.subscribers (id, nome, email, plano, status)
  values (
    new.id,
    coalesce(new.raw_user_meta_data->>'nome', new.raw_user_meta_data->>'full_name', new.raw_user_meta_data->>'name', split_part(new.email, '@', 1)),
    new.email,
    'free',
    'trial'
  );
  return new;
end;
$$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();

-- ── 4. HELPER: is_admin() sem recursão de RLS ────────────────
create or replace function public.is_admin()
returns boolean
language sql
security definer set search_path = public
stable
as $$
  select coalesce((select is_admin from public.subscribers where id = auth.uid()), false);
$$;

-- ── 5. ROW LEVEL SECURITY ─────────────────────────────────────
alter table public.subscribers enable row level security;
alter table public.lancamentos  enable row level security;

-- subscribers: cada um vê/edita só o próprio perfil; admin vê/edita todos
create policy "subscriber_select_own_or_admin" on public.subscribers
  for select using (auth.uid() = id or public.is_admin());

create policy "subscriber_update_own_or_admin" on public.subscribers
  for update using (auth.uid() = id or public.is_admin());

create policy "subscriber_delete_admin_only" on public.subscribers
  for delete using (public.is_admin());

-- lancamentos: cada assinante só acessa os próprios lançamentos
create policy "lancamentos_select_own" on public.lancamentos
  for select using (auth.uid() = subscriber_id);

create policy "lancamentos_insert_own" on public.lancamentos
  for insert with check (auth.uid() = subscriber_id);

create policy "lancamentos_update_own" on public.lancamentos
  for update using (auth.uid() = subscriber_id);

create policy "lancamentos_delete_own" on public.lancamentos
  for delete using (auth.uid() = subscriber_id);

-- ── 5b. INTEGRAÇÕES COM ERP (tokens — só o backend acessa) ─────
create table if not exists public.integracoes_erp (
  id             uuid primary key default gen_random_uuid(),
  subscriber_id  uuid not null references public.subscribers(id) on delete cascade,
  provider       text not null default 'bling' check (provider in ('bling')),
  access_token   text not null,
  refresh_token  text not null,
  expires_at     timestamptz not null,
  ultima_sincronizacao timestamptz,
  created_at     timestamptz default now(),
  updated_at     timestamptz default now(),
  unique (subscriber_id, provider)
);

alter table public.integracoes_erp enable row level security;
-- Nenhuma policy para anon/authenticated: só o service_role (usado pelo backend) acessa esta tabela.

create index if not exists idx_integracoes_erp_subscriber on public.integracoes_erp(subscriber_id);

-- ── 6. ÍNDICES ─────────────────────────────────────────────────
create index idx_subscribers_status     on public.subscribers(status);
create index idx_subscribers_plano      on public.subscribers(plano);
create index idx_lancamentos_subscriber on public.lancamentos(subscriber_id);
create index idx_lancamentos_tipo       on public.lancamentos(tipo);
create index idx_lancamentos_status     on public.lancamentos(status);
create index idx_lancamentos_venc       on public.lancamentos(vencimento);
create index idx_lancamentos_contraparte on public.lancamentos(contraparte);

-- ============================================================
-- PÓS-INSTALAÇÃO (fazer manualmente, uma vez):
--
-- 1. Crie sua própria conta em https://meuargus.com/app (botão de cadastro).
-- 2. Rode o comando abaixo trocando o e-mail pelo que você cadastrou,
--    para virar admin e poder acessar /admin:
--
--    update public.subscribers set is_admin = true where email = 'SEU_EMAIL_AQUI';
--
-- ============================================================
