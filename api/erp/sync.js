// POST /api/erp/sync  { provider: 'bling' }
// Busca contas a pagar/receber no ERP conectado e grava em `lancamentos` (origem='erp').

import { getProvider } from '../_lib/providers/index.js';
import {
  getAuthenticatedSubscriber,
  getIntegracao,
  patchIntegracao,
  upsertLancamentos,
  upsertProdutos,
  upsertVendasItens,
  getContatosCache,
  upsertContatosCache,
  getSyncEstado,
  saveSyncEstado,
  deleteSyncEstado,
  getSaldosCaixasCalculados,
  upsertSaldosCaixas,
} from '../_lib/supabase.js';

// Ponto de partida quando ainda não existe nenhum saldo calculado pra essa
// conta — bem anterior a qualquer empresa usando o MeuArgus, só pra
// garantir que pega o histórico inteiro do Bling na primeira sincronização.
const ANCHOR_INICIO_POSICAO_CAIXA = '2015-01-01';

// "Wise USD", "Wise EUR"... — é assim que a Flutu nomeou as contas
// multi-moeda no Bling (confirmado por print da tela Caixas e Bancos). Não
// tem campo de moeda na API, então a moeda é inferida do nome da conta;
// contas sem esse padrão (Caixa, Itaú, Nubank...) são tratadas como BRL.
function inferirMoedaPosicaoCaixa(descricao) {
  const m = /^wise\s+([a-z]{3})$/i.exec((descricao || '').trim());
  return m ? m[1].toUpperCase() : 'BRL';
}

// Soma crédito menos débito de /caixas, uma página de cada vez, com o mesmo
// espaçamento usado no resto do sync pro rate limit do Bling (3 req/s).
// Resumível: se o tempo acabar no meio, salva o progresso (página atual +
// acumulado parcial por conta) em sync_estado e retoma dali na próxima
// chamada — só grava o resultado final em saldos_caixas quando a
// paginação chega ao fim de verdade. Sincronizações seguintes (depois da
// primeira, que pega o histórico inteiro) partem de ultima_data_sincronizada
// + 1 dia, então ficam rápidas.
async function sincronizarPosicaoCaixa(inicioHandler, subscriberId, providerName, provider, ctx) {
  if (typeof provider.fetchPaginaCaixas !== 'function') {
    return { ok: false, error: 'provider_sem_suporte_posicao_caixa' };
  }
  const LIMITE_MS = 55_000;
  const ESPACO_PAGINAS_MS = 350;

  let estado = await getSyncEstado(subscriberId, providerName, 'posicao_caixa');
  if (!estado) {
    const existentes = await getSaldosCaixasCalculados(subscriberId, providerName);
    if (existentes.length) {
      const maiorDataAnterior = existentes.reduce(
        (m, r) => (r.ultima_data_sincronizada > m ? r.ultima_data_sincronizada : m),
        existentes[0].ultima_data_sincronizada
      );
      const proximoDia = new Date(`${maiorDataAnterior}T00:00:00Z`);
      proximoDia.setUTCDate(proximoDia.getUTCDate() + 1);
      estado = {
        pagina: 1,
        dataInicial: proximoDia.toISOString().slice(0, 10),
        acumulado: Object.fromEntries(existentes.map((r) => [r.conta_financeira_id, { descricao: r.nome, soma: Number(r.valor) }])),
        maiorData: maiorDataAnterior,
      };
    } else {
      estado = { pagina: 1, dataInicial: ANCHOR_INICIO_POSICAO_CAIXA, acumulado: {}, maiorData: null };
    }
  }

  const dataFinalHoje = new Date().toISOString().slice(0, 10);
  let pagina = estado.pagina;
  const acumulado = estado.acumulado;
  let maiorData = estado.maiorData;
  let concluido = false;

  // Diagnóstico: contagem e soma separadas de C e D por conta, pra investigar
  // discrepância vista em produção (Wise CAD e Wise USD bem acima do saldo
  // real do Bling — suspeita de transferência entre contas Wise contada só
  // do lado do crédito, sem o débito correspondente baixar o saldo).
  const diagnostico = estado.diagnostico || {};

  while (Date.now() - inicioHandler < LIMITE_MS) {
    if (pagina > 1) await new Promise((r) => setTimeout(r, ESPACO_PAGINAS_MS));
    const registros = await provider.fetchPaginaCaixas(ctx, { dataInicial: estado.dataInicial, dataFinal: dataFinalHoje, pagina });
    if (!registros.length) { concluido = true; break; }
    for (const r of registros) {
      const contaId = String(r.contaFinanceira?.id ?? 'sem_conta');
      const descricao = r.contaFinanceira?.descricao || 'Conta sem nome';
      const valorNum = Number(r.valor) || 0;
      const sinal = r.debCred === 'C' ? 1 : -1;
      if (!acumulado[contaId]) acumulado[contaId] = { descricao, soma: 0 };
      acumulado[contaId].descricao = descricao;
      acumulado[contaId].soma += sinal * valorNum;
      if (!maiorData || r.data > maiorData) maiorData = r.data;

      if (!diagnostico[contaId]) diagnostico[contaId] = { descricao, qtdC: 0, somaC: 0, qtdD: 0, somaD: 0, amostra: [] };
      const d = diagnostico[contaId];
      if (r.debCred === 'C') { d.qtdC++; d.somaC += valorNum; } else { d.qtdD++; d.somaD += valorNum; }
      if (d.amostra.length < 5) d.amostra.push({ id: r.id, data: r.data, debCred: r.debCred, valor: valorNum, descricao: r.descricao, origem: r.origem });
    }
    pagina++;
  }

  if (concluido) {
    const registros = Object.entries(acumulado).map(([contaId, { descricao, soma }]) => ({
      subscriber_id: subscriberId,
      provider: providerName,
      conta_financeira_id: contaId,
      nome: descricao,
      moeda: inferirMoedaPosicaoCaixa(descricao),
      valor: soma,
      ultima_data_sincronizada: maiorData || dataFinalHoje,
    }));
    const r = await upsertSaldosCaixas(registros);
    if (!r.ok) throw new Error(`Falha ao gravar posição de caixa: ${await r.text()}`);
    await deleteSyncEstado(subscriberId, providerName, 'posicao_caixa');
    for (const [contaId, d] of Object.entries(diagnostico)) {
      if (!/wise/i.test(d.descricao)) continue;
      console.log(`posicao_caixa diagnostico [${d.descricao} / conta ${contaId}]: C: ${d.qtdC}x somando ${d.somaC.toFixed(2)} | D: ${d.qtdD}x somando ${d.somaD.toFixed(2)} | líquido: ${(d.somaC - d.somaD).toFixed(2)} | amostra:`, JSON.stringify(d.amostra));
    }
    return { ok: true, concluido: true, contas: registros.length };
  }

  await saveSyncEstado(subscriberId, providerName, 'posicao_caixa', { pagina, dataInicial: estado.dataInicial, acumulado, maiorData, diagnostico });
  return { ok: true, concluido: false, paginaAtual: pagina };
}

// Orçamento de tempo pra resolver nomes de contato novos, calculado com o que
// *sobra* depois de buscar as contas — não um número fixo a partir do início
// da function. Um orçamento fixo (testado: 20s a partir do início) ignorava
// que buscar as contas sozinho já podia consumir esse tempo todo em contas
// com bastante histórico (visto em produção: 0 contatos resolvidos mesmo após
// vários syncs OK, porque a etapa de contatos nunca chegava a rodar). Reserva
// tempo pras etapas seguintes (gravar lançamentos, produtos, itens de venda,
// marcar sincronizado) pra não estourar os 60s da function.
const LIMITE_FUNCTION_MS = 58_000; // margem sob o teto real de 60s
const RESERVA_POS_CONTATOS_MS = 15_000;
const MAX_CONTATOS_CANDIDATOS = 400; // teto só pra não montar um array enorme à toa

export default async function handler(req, res) {
  const inicioHandler = Date.now();
  if (req.method !== 'POST') return res.status(405).json({ error: 'method_not_allowed' });

  const { provider: providerName, tipo } = req.body || {};
  if (!providerName) return res.status(400).json({ error: 'provider obrigatório' });

  const subscriberId = await getAuthenticatedSubscriber(req);
  if (!subscriberId) return res.status(401).json({ error: 'não autenticado' });

  let provider;
  try {
    provider = getProvider(providerName);
  } catch {
    return res.status(400).json({ error: 'provider_desconhecido' });
  }

  let integracao = await getIntegracao(subscriberId, providerName);
  if (!integracao) return res.status(404).json({ error: 'erp_nao_conectado' });

  try {
    // Providers OAuth2 têm token que expira e precisa renovar; apikey não.
    if (provider.authType === 'oauth2' && new Date(integracao.expires_at).getTime() < Date.now() + 60_000) {
      const refreshed = await provider.refreshToken({ refreshToken: integracao.refresh_token });
      const expiresAt = new Date(Date.now() + refreshed.expiresIn * 1000).toISOString();
      await patchIntegracao(integracao.id, {
        access_token: refreshed.accessToken,
        refresh_token: refreshed.refreshToken,
        expires_at: expiresAt,
      });
      integracao = { ...integracao, access_token: refreshed.accessToken };
    }

    // OAuth2 usa accessToken/realmId; apikey usa os campos declarados em
    // provider.credentialFields, guardados em `credentials` (jsonb). Uma
    // integração Omie antiga (de antes dessa coluna existir) ainda guarda
    // appKey/appSecret em access_token/refresh_token — cai no fallback abaixo.
    const ctx = provider.authType === 'oauth2'
      ? { accessToken: integracao.access_token, realmId: integracao.erp_account_id }
      : (integracao.credentials || { appKey: integracao.access_token, appSecret: integracao.refresh_token });

    // Sincronização da posição de caixa (Caixas e Bancos) é um fluxo à parte
    // do sync normal de contas a pagar/receber — não mexe em lançamentos,
    // produtos ou o "ultima_sincronizacao" da integração.
    if (tipo === 'posicao_caixa') {
      const resultado = await sincronizarPosicaoCaixa(inicioHandler, subscriberId, providerName, provider, ctx);
      return res.status(200).json(resultado);
    }

    // Sequencial, não em paralelo: cada chamada pagina sozinha, e rodar as
    // duas ao mesmo tempo dobra o ritmo de chamadas contra o limite de taxa
    // do ERP (Bling: 3 requisições/segundo) — visto derrubando a sincronização
    // de contas com bastante histórico.
    const pagar = await provider.fetchContas({ ...ctx, tipo: 'pagar' });
    const receber = await provider.fetchContas({ ...ctx, tipo: 'receber' });
    console.log(`${providerName} sync: contas levaram ${Date.now() - inicioHandler}ms (pagar ${pagar.length}, receber ${receber.length})`);

    // Nome do contato: alguns providers (hoje só Bling) não trazem o nome já
    // na listagem de contas, só o ID — busca à parte, cacheada, pra não achar
    // "Contato Bling #123" em vez do nome do cliente/fornecedor no painel.
    let contatosMap = {};
    if (typeof provider.fetchContatoNomes === 'function') {
      try {
        const idsUnicos = [...new Set(
          [...pagar, ...receber].map((c) => c.contato?.id).filter(Boolean).map(String)
        )];
        if (idsUnicos.length) {
          const cache = await getContatosCache(subscriberId, providerName, idsUnicos);
          const faltantes = idsUnicos.filter((id) => !cache[id]).slice(0, MAX_CONTATOS_CANDIDATOS);
          let novos = {};
          if (faltantes.length) {
            const orcamentoContatos = Math.max(0, LIMITE_FUNCTION_MS - (Date.now() - inicioHandler) - RESERVA_POS_CONTATOS_MS);
            novos = await provider.fetchContatoNomes(ctx, faltantes, Date.now() + orcamentoContatos);
            console.log(`${providerName} sync: orçamento contatos ${orcamentoContatos}ms, resolvidos ${Object.keys(novos).length}/${faltantes.length} (${idsUnicos.length} contatos distintos no total)`);
            const registros = Object.entries(novos).map(([contatoErpId, nome]) => ({
              subscriber_id: subscriberId, provider: providerName, contato_erp_id: contatoErpId, nome,
            }));
            const r = await upsertContatosCache(registros);
            if (!r.ok) console.error(`${providerName} sync contatos: falha ao gravar cache`, await r.text());
          }
          contatosMap = { ...cache, ...novos };
        }
      } catch (err) {
        console.error(`${providerName} sync contatos error`, err);
      }
    }

    const lancamentos = [
      ...pagar.map((c) => provider.mapConta(c, 'pagar', subscriberId, contatosMap)),
      ...receber.map((c) => provider.mapConta(c, 'receber', subscriberId, contatosMap)),
    ];

    let gravados = 0;
    if (lancamentos.length) {
      const upsertResp = await upsertLancamentos(lancamentos);
      if (!upsertResp.ok) throw new Error(`Falha ao gravar lançamentos: ${await upsertResp.text()}`);
      gravados = lancamentos.length;
    }

    // Estoque e itens vendidos: só pra providers que implementam isso (hoje
    // só Bling). Roda separado, sem deixar uma falha aqui derrubar o sync
    // de contas a pagar/receber, que já é validado e é o que mais importa.
    let produtosSincronizados = 0, itensVendaSincronizados = 0;
    if (typeof provider.fetchProdutos === 'function') {
      try {
        const produtosBrutos = await provider.fetchProdutos(ctx);
        const produtos = produtosBrutos.map((p) => provider.mapProduto(p, subscriberId));
        if (produtos.length) {
          const r = await upsertProdutos(produtos);
          if (!r.ok) throw new Error(await r.text());
          produtosSincronizados = produtos.length;
        }
      } catch (err) {
        console.error(`${providerName} sync produtos error`, err);
      }
    }
    if (typeof provider.fetchItensVenda === 'function') {
      try {
        const pedidosComItens = await provider.fetchItensVenda(ctx);
        const itens = pedidosComItens.flatMap(({ pedido, itens: itensPedido }) =>
          itensPedido.map((item) => provider.mapItemVenda(pedido, item, subscriberId))
        );
        if (itens.length) {
          const r = await upsertVendasItens(itens);
          if (!r.ok) throw new Error(await r.text());
          itensVendaSincronizados = itens.length;
        }
      } catch (err) {
        console.error(`${providerName} sync itens de venda error`, err);
      }
    }

    await patchIntegracao(integracao.id, { ultima_sincronizacao: new Date().toISOString() });

    return res.status(200).json({ ok: true, sincronizados: gravados, produtosSincronizados, itensVendaSincronizados });
  } catch (err) {
    console.error(`${providerName} sync error`, err);
    return res.status(500).json({ error: 'sync_failed', detail: String(err.message || err) });
  }
}
