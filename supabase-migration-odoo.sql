-- Migração pra habilitar o conector Odoo (4 campos de credencial, em vez dos
-- 2 que Omie usava) numa tabela integracoes_erp que já existe em produção.
-- Rode isto uma vez no SQL Editor do Supabase. Idempotente — pode rodar de novo sem erro.

alter table public.integracoes_erp
  alter column access_token drop not null,
  alter column refresh_token drop not null,
  add column if not exists credentials jsonb;

do $$
declare
  con_name text;
begin
  select conname into con_name
  from pg_constraint
  where conrelid = 'public.integracoes_erp'::regclass
    and contype = 'c'
    and pg_get_constraintdef(oid) like '%provider%';
  if con_name is not null then
    execute format('alter table public.integracoes_erp drop constraint %I', con_name);
  end if;
end $$;

alter table public.integracoes_erp
  add constraint integracoes_erp_provider_check
  check (provider in ('bling','contaazul','quickbooks','omie','odoo'));
