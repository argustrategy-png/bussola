-- Migração de segurança (parte 1 de 2). Rode no SQL Editor do Supabase.
-- Idempotente — pode rodar de novo sem erro.
--
-- 1. subscribers: a policy de update deixava o próprio usuário alterar
--    QUALQUER coluna da sua linha (is_admin, plano, status, expira,
--    stripe_customer_id...). Pelo console do navegador dava pra virar admin
--    ou apontar o stripe_customer_id pra conta Stripe de outro cliente.
--    Agora o usuário comum só altera nome, empresa, tel e ultimo_acesso; o
--    resto só muda por admin ou pelo backend (service_role: webhook do
--    Stripe, rotas de admin).
-- 2. lancamentos / saldos_caixas: update sem `with check` deixava mover a
--    própria linha pra outro subscriber_id (injetar lançamento na conta de
--    outra pessoa).
-- 3. lancamentos.erp_id era único na tabela inteira. "odoo:42" de duas
--    empresas diferentes colidia e o upsert do sync trocava o dono da linha
--    (lançamento de um cliente aparecia na conta do outro). Passa a ser
--    único por assinante. A unicidade antiga só é removida na parte 2,
--    depois que o código novo (on_conflict=subscriber_id,erp_id) estiver no ar.

-- ── 1. subscribers: colunas protegidas ─────────────────────────────────
create or replace function public.subscribers_protege_colunas()
returns trigger
language plpgsql
-- Sem security definer de propósito: o teste abaixo depende de current_user
-- ser quem fez o update, não o dono da função.
set search_path = public
as $$
begin
  -- Backend (service_role) e SQL Editor (postgres) passam direto; só o
  -- usuário logado no app (role authenticated) é restringido.
  if current_user <> 'authenticated' or public.is_admin() then
    return new;
  end if;

  if new.id is distinct from old.id
     or new.email is distinct from old.email
     or new.is_admin is distinct from old.is_admin
     or new.plano is distinct from old.plano
     or new.expira is distinct from old.expira
     or new.cadastro is distinct from old.cadastro
     or new.obs is distinct from old.obs
     or new.stripe_customer_id is distinct from old.stripe_customer_id
     or new.stripe_subscription_id is distinct from old.stripe_subscription_id
  then
    raise exception 'Sem permissão para alterar estes dados da conta.' using errcode = '42501';
  end if;

  -- Única mudança de status permitida ao próprio usuário: o app marca o
  -- teste grátis como expirado quando a data já passou (index.html, onAuthed).
  if new.status is distinct from old.status
     and not (old.status = 'trial' and new.status = 'expirado' and old.expira < current_date)
  then
    raise exception 'Sem permissão para alterar o status da conta.' using errcode = '42501';
  end if;

  return new;
end;
$$;

drop trigger if exists subscribers_protege_colunas on public.subscribers;
create trigger subscribers_protege_colunas
  before update on public.subscribers
  for each row execute function public.subscribers_protege_colunas();

drop policy if exists "subscriber_update_own_or_admin" on public.subscribers;
create policy "subscriber_update_own_or_admin" on public.subscribers
  for update using (auth.uid() = id or public.is_admin())
  with check (auth.uid() = id or public.is_admin());

-- ── 2. with check nas policies de update ───────────────────────────────
drop policy if exists "lancamentos_update_own" on public.lancamentos;
create policy "lancamentos_update_own" on public.lancamentos
  for update using (auth.uid() = subscriber_id)
  with check (auth.uid() = subscriber_id);

drop policy if exists "saldos_caixas_update_own" on public.saldos_caixas;
create policy "saldos_caixas_update_own" on public.saldos_caixas
  for update using (auth.uid() = subscriber_id)
  with check (auth.uid() = subscriber_id);

-- ── 3. erp_id único por assinante (convive com o antigo até a parte 2) ──
create unique index if not exists lancamentos_subscriber_erp_id_key
  on public.lancamentos(subscriber_id, erp_id);

-- Conferência: deve listar o trigger e as policies com with_check preenchido.
select tablename, policyname, cmd, with_check is not null as tem_with_check
from pg_policies
where schemaname = 'public' and tablename in ('subscribers', 'lancamentos', 'saldos_caixas') and cmd = 'UPDATE';
