-- ============================================================
-- BÚSSOLA FINANCEIRA — Supabase Schema
-- Cole este SQL no Supabase: SQL Editor → New Query → Run
-- ============================================================


-- ── 1. TABELA DE ASSINANTES ──────────────────────────────
create table if not exists public.subscribers (
  id          uuid primary key default gen_random_uuid(),
  nome        text not null,
  email       text not null unique,
  tel         text,
  empresa     text,
  plano       text not null default 'free' check (plano in ('free','pro','premium')),
  status      text not null default 'ativo' check (status in ('ativo','trial','inativo','expirado')),
  cadastro    date default current_date,
  expira      date,
  ultimo_acesso date default current_date,
  obs         text,
  created_at  timestamptz default now()
);

-- ── 2. TABELA DE LANÇAMENTOS (Fluxo de Caixa) ────────────
create table if not exists public.lancamentos (
  id          uuid primary key default gen_random_uuid(),
  tipo        text not null check (tipo in ('receber','pagar')),
  descricao   text not null,
  valor       numeric(12,2) not null,
  vencimento  date,
  categoria   text,
  status      text not null default 'pendente' check (status in ('pendente','pago')),
  recorrencia text default 'none',
  toc         text default 'do',
  created_at  timestamptz default now()
);

-- ── 3. ROW LEVEL SECURITY ────────────────────────────────
-- Habilita RLS (segurança por linha)
alter table public.subscribers enable row level security;
alter table public.lancamentos  enable row level security;

-- Política: permite acesso apenas com a anon key (acesso público autenticado via chave)
-- Para um app simples sem auth de usuários, usamos acesso irrestrito pela anon key.
-- A segurança real vem de manter a service_role key privada.

create policy "anon_all_subscribers" on public.subscribers
  for all using (true) with check (true);

create policy "anon_all_lancamentos" on public.lancamentos
  for all using (true) with check (true);

-- ── 4. ÍNDICES para performance ──────────────────────────
create index if not exists idx_subscribers_status on public.subscribers(status);
create index if not exists idx_subscribers_plano  on public.subscribers(plano);
create index if not exists idx_lancamentos_tipo   on public.lancamentos(tipo);
create index if not exists idx_lancamentos_status on public.lancamentos(status);
create index if not exists idx_lancamentos_venc   on public.lancamentos(vencimento);

-- ── 5. DADOS DE DEMONSTRAÇÃO (opcional) ─────────────────
-- Remova este bloco se não quiser dados de exemplo.
insert into public.subscribers (nome, email, tel, empresa, plano, status, cadastro, expira, ultimo_acesso, obs)
values
  ('Ana Carolina Mendes',  'ana@acmfinancas.com.br',    '(11) 98765-4321', 'ACM Finanças',          'premium', 'ativo',    '2026-01-15', '2027-01-15', '2026-05-30', 'Cliente VIP, migrou do plano Pro.'),
  ('Roberto Figueiredo',   'rfigueiredo@construtora.com','(21) 99876-5432', 'Construtora Figueiredo','pro',     'ativo',    '2026-02-03', '2027-02-03', '2026-05-28', ''),
  ('Mariana Souza',        'mariana@mssolucoes.com',     '(31) 98888-7777', 'MS Soluções',           'pro',     'trial',    '2026-05-20', '2026-06-20', '2026-06-01', 'Em período de avaliação de 30 dias.'),
  ('Carlos Eduardo Lima',  'carlos@limaconsult.com',     '',                'Lima Consultoria',      'free',    'ativo',    '2025-11-10', null,         '2026-04-15', ''),
  ('Fernanda Torres',      'fernanda@torresinvest.com',  '(11) 97654-3210', 'Torres Investimentos',  'premium', 'expirado', '2025-06-01', '2026-05-31', '2026-05-15', 'Plano venceu, aguardando renovação.'),
  ('Paulo Henrique Ramos', 'paulo@phremp.com',           '(41) 99123-4567', 'PH Empreendimentos',    'pro',     'inativo',  '2025-08-22', '2026-08-22', '2026-01-10', 'Cancelou por motivos internos.')
on conflict (email) do nothing;
