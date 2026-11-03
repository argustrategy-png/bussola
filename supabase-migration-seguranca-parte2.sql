-- Migração de segurança (parte 2 de 2). Rode SÓ DEPOIS que o código com
-- on_conflict=subscriber_id,erp_id (api/_lib/supabase.js, upsertLancamentos)
-- estiver publicado. Antes disso o sync do ERP quebra, porque o código
-- antigo depende da unicidade global de erp_id que este arquivo remove.
-- Idempotente.

alter table public.lancamentos drop constraint if exists lancamentos_erp_id_key;
