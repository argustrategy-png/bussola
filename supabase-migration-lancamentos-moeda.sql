-- Moeda de cada lançamento (conta a pagar/receber) — o Bling não expõe isso
-- na listagem em massa, só via o "portador" (= conta financeira) no detalhe
-- de cada conta, ou via a conta financeira que liquidou o pagamento (pros já
-- pagos). NULL = ainda não resolvido (trata como BRL na tela, mas permite
-- reprocessar depois); nunca grava 'BRL' por padrão pra não confundir "já
-- verificado que é BRL" com "nunca verificado".
--
-- Rode uma vez no SQL Editor do Supabase. Idempotente.

alter table public.lancamentos
  add column if not exists moeda text;

create index if not exists idx_lancamentos_moeda_pendente
  on public.lancamentos(subscriber_id)
  where moeda is null and origem = 'erp';
