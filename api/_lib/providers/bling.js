// Adaptador Bling — referência para os outros adaptadores (contaazul.js, quickbooks.js, omie.js).
// Cada adaptador OAuth2 exporta: authType, authorizeUrl(), exchangeCode(), refreshToken(),
// fetchAccountId(), fetchContas(), mapConta().

const TOKEN_URL = 'https://www.bling.com.br/Api/v3/oauth/token';
const EMPRESAS_URL = 'https://api.bling.com.br/Api/v3/empresas/me/dados-basicos';
const API_BASE = 'https://api.bling.com.br/Api/v3';

const POR_PAGINA = 100;
// Teto de segurança: a function da Vercel tem tempo limitado e o Bling limita
// a 3 requisições por segundo, então não dá pra puxar histórico infinito.
const MAX_PAGINAS = 20;

// GET com novas tentativas em 429 (limite de taxa do Bling — 3 requisições
// por segundo). Backoff crescente: contas com muito histórico paginam bastante
// e, combinado com outras chamadas da mesma sincronização, passam do limite
// mais de uma vez; uma só tentativa extra não bastava (visto em produção).
async function getComRetry429(url, accessToken, tentativa = 0) {
  // Só 2 tentativas extras: as chamadas já são espaçadas na origem (contas
  // pagina sequencial; fetchContatoNomes com ESPACO_MS entre cada uma), então
  // um 429 aqui é a exceção, não a regra — não vale gastar muito do teto de
  // tempo da function retentando algo que provavelmente já vai passar.
  const MAX_TENTATIVAS = 2;
  const resp = await fetch(url, { headers: { Authorization: `Bearer ${accessToken}`, Accept: 'application/json' } });
  if (resp.status === 429 && tentativa < MAX_TENTATIVAS) {
    await new Promise((r) => setTimeout(r, 1000 * (tentativa + 1)));
    return getComRetry429(url, accessToken, tentativa + 1);
  }
  return resp;
}

// Percorre todas as páginas de uma listagem do Bling (pagina=1,2,...) até vir
// uma página incompleta.
async function fetchTodasPaginas(caminho, accessToken, rotulo) {
  const ESPACO_ENTRE_PAGINAS_MS = 200; // sob o limite de 3 req/s, com margem
  const todos = [];
  for (let pagina = 1; pagina <= MAX_PAGINAS; pagina++) {
    if (pagina > 1) await new Promise((r) => setTimeout(r, ESPACO_ENTRE_PAGINAS_MS));
    const url = `${API_BASE}${caminho}${caminho.includes('?') ? '&' : '?'}pagina=${pagina}&limite=${POR_PAGINA}`;
    const resp = await getComRetry429(url, accessToken);
    if (!resp.ok) throw new Error(`Bling ${rotulo} falhou: ${resp.status} ${await resp.text()}`);
    const itens = (await resp.json())?.data || [];
    todos.push(...itens);
    if (itens.length < POR_PAGINA) break;
  }
  return todos;
}

export const bling = {
  name: 'bling',
  label: 'Bling',
  authType: 'oauth2',

  authorizeUrl({ state, redirectUri }) {
    const clientId = process.env.BLING_CLIENT_ID;
    return `https://www.bling.com.br/Api/v3/oauth/authorize?response_type=code&client_id=${encodeURIComponent(clientId)}&state=${encodeURIComponent(state)}&redirect_uri=${encodeURIComponent(redirectUri)}`;
  },

  async exchangeCode({ code, redirectUri }) {
    const basic = Buffer.from(`${process.env.BLING_CLIENT_ID}:${process.env.BLING_CLIENT_SECRET}`).toString('base64');
    const resp = await fetch(TOKEN_URL, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
        Accept: '1.0',
        Authorization: `Basic ${basic}`,
      },
      body: new URLSearchParams({ grant_type: 'authorization_code', code, redirect_uri: redirectUri }),
    });
    const data = await resp.json();
    if (!resp.ok || !data.access_token) throw new Error(`Bling exchangeCode falhou: ${JSON.stringify(data)}`);
    return { accessToken: data.access_token, refreshToken: data.refresh_token, expiresIn: data.expires_in || 21600 };
  },

  async refreshToken({ refreshToken }) {
    const basic = Buffer.from(`${process.env.BLING_CLIENT_ID}:${process.env.BLING_CLIENT_SECRET}`).toString('base64');
    const resp = await fetch(TOKEN_URL, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
        Accept: '1.0',
        Authorization: `Basic ${basic}`,
      },
      body: new URLSearchParams({ grant_type: 'refresh_token', refresh_token: refreshToken }),
    });
    const data = await resp.json();
    if (!resp.ok || !data.access_token) throw new Error(`Bling refreshToken falhou: ${JSON.stringify(data)}`);
    return { accessToken: data.access_token, refreshToken: data.refresh_token || refreshToken, expiresIn: data.expires_in || 21600 };
  },

  // Identificador estável da empresa no Bling (CNPJ) — usado pra travar 1 Bling = 1 conta MeuArgus.
  async fetchAccountId({ accessToken }) {
    const resp = await fetch(EMPRESAS_URL, { headers: { Authorization: `Bearer ${accessToken}`, Accept: 'application/json' } });
    if (!resp.ok) {
      const text = await resp.text();
      throw new Error(`Bling /empresas falhou: ${resp.status} ${text}`);
    }
    const json = await resp.json();
    const empresa = json?.data?.[0] || json?.data || json;
    const cnpj = empresa?.cnpj || empresa?.documento;
    if (!cnpj) throw new Error('Bling /empresas não retornou CNPJ');
    return cnpj;
  },

  async fetchContas({ accessToken, tipo }) {
    return fetchTodasPaginas(`/contas/${tipo}`, accessToken, `contas/${tipo}`);
  },

  // Confirmado contra o OpenAPI oficial do Bling (ContasDadosBaseDTO): a
  // listagem só traz id/situacao/vencimento/valor/contato.id — sem nome do
  // contato, categoria ou histórico. O nome vem à parte via fetchContatoNomes
  // (um GET /contatos/{id} por contato, cacheado em contatos_cache — ver
  // sync.js), e chega aqui pronto em `contatosMap` (id → nome).
  mapConta(conta, tipo, subscriberId, contatosMap = {}) {
    // situacao: 1 Aberto, 2 Pago, 3 Parcial, 4 Devolvido, 5 Cancelado, 6 Devolvido parcial, 7 Confirmado
    const status = conta.situacao === 2 ? 'pago' : 'pendente';
    const contatoId = conta.contato?.id;
    const nomeContato = contatoId ? contatosMap[String(contatoId)] : null;
    return {
      subscriber_id: subscriberId,
      tipo,
      descricao: `Conta ${tipo === 'pagar' ? 'a pagar' : 'a receber'} Bling #${conta.id}`,
      valor: Number(conta.valor) || 0,
      vencimento: conta.vencimento || null,
      categoria: null,
      status,
      recorrencia: 'none',
      toc: tipo === 'pagar' ? 'do' : 'na',
      origem: 'erp',
      contraparte: nomeContato || (contatoId ? `Contato Bling #${contatoId}` : null),
      contraparte_telefone: null,
      erp_id: `bling:${conta.id}`,
    };
  },

  // Nome dos contatos por ID. Sequencial, uma chamada de cada vez, com um
  // espaço mínimo entre elas — 5 em paralelo (a versão anterior) disparava
  // rajada contra o limite de 3 req/s do Bling e quase todas voltavam 429,
  // deixando a conta inteira sem nenhum nome resolvido (visto em produção:
  // 0 contatos cacheados pro Bruno). `ids` já vem filtrado pelo chamador
  // (sync.js) só com os que faltam no cache.
  //
  // `deadline` (timestamp em ms, opcional) pára a busca no meio da lista se o
  // tempo acabar, em vez de estourar o limite da function — cada contato só
  // entra no resultado (e no cache) depois de resolvido, então parar no meio
  // não perde nada do que já foi feito; o resto fica pra próxima sincronização.
  async fetchContatoNomes({ accessToken }, ids, deadline) {
    const ESPACO_MS = 350; // ~2,8 req/s, com margem sob o limite de 3 req/s
    const resultado = {};
    let primeiroErro = null; // diagnóstico: por que nada resolveu (ex.: escopo faltando)
    for (let i = 0; i < ids.length; i++) {
      if (deadline && Date.now() >= deadline) break;
      if (i > 0) await new Promise((r) => setTimeout(r, ESPACO_MS));
      const id = ids[i];
      const r = await getComRetry429(`${API_BASE}/contatos/${id}`, accessToken);
      if (!r.ok) {
        if (!primeiroErro) primeiroErro = `${r.status} ${(await r.text()).slice(0, 300)}`;
        continue;
      }
      const dados = (await r.json())?.data;
      if (dados?.nome) resultado[id] = dados.nome;
    }
    if (primeiroErro && Object.keys(resultado).length === 0) {
      console.error('bling fetchContatoNomes: nenhum contato resolvido, primeiro erro:', primeiroErro);
    }
    return resultado;
  },

  // Posição de estoque: confirmado contra o wrapper open-source
  // bling-erp-api-js que o /produtos já devolve estoque.saldoVirtualTotal
  // embutido — não precisa de uma chamada extra em /estoques/saldos.
  async fetchProdutos({ accessToken }) {
    // Nota: não filtramos por `situacao` na query — esse parâmetro não foi
    // confirmado como filtro aceito pelo endpoint (só como campo de
    // resposta); produtos inativos entram e ficam marcados via `situacao`
    // no registro salvo, pra UI decidir se esconde.
    return fetchTodasPaginas('/produtos', accessToken, '/produtos');
  },

  mapProduto(produto, subscriberId) {
    // `situacao` pode vir como string simples ou como objeto {id,nome} — o
    // formato exato não foi confirmado, então aceita os dois sem quebrar.
    const situacao = typeof produto.situacao === 'object' && produto.situacao !== null
      ? (produto.situacao.nome || produto.situacao.id || null)
      : (produto.situacao || null);
    return {
      subscriber_id: subscriberId,
      provider: 'bling',
      erp_id: String(produto.id),
      nome: produto.nome,
      codigo: produto.codigo || null,
      preco: Number(produto.preco) || null,
      estoque_atual: produto.estoque?.saldoVirtualTotal ?? null,
      situacao: situacao ? String(situacao) : null,
    };
  },

  // Itens vendidos: a listagem de pedidos de venda não traz os itens (só
  // vem no detalhe por pedido — GET /pedidos/vendas/{id}), então pra saber
  // "o que" foi vendido é preciso 1 chamada extra por pedido. Limitado aos
  // últimos 30 dias e no máximo 30 pedidos por sync, em lotes pequenos, pra
  // não estourar o limite de tempo da function nem o rate limit do Bling.
  async fetchItensVenda({ accessToken }) {
    const hoje = new Date();
    const trintaDiasAtras = new Date(hoje.getTime() - 30 * 24 * 60 * 60 * 1000);
    const fmt = (d) => d.toISOString().split('T')[0];
    const listaResp = await fetch(
      `${API_BASE}/pedidos/vendas?pagina=1&limite=30&dataInicial=${fmt(trintaDiasAtras)}&dataFinal=${fmt(hoje)}`,
      { headers: { Authorization: `Bearer ${accessToken}`, Accept: 'application/json' } }
    );
    if (!listaResp.ok) throw new Error(`Bling /pedidos/vendas falhou: ${listaResp.status} ${await listaResp.text()}`);
    const pedidos = (await listaResp.json())?.data || [];

    const LOTE = 5;
    const itensPorPedido = [];
    for (let i = 0; i < pedidos.length; i += LOTE) {
      const lote = pedidos.slice(i, i + LOTE);
      const detalhes = await Promise.all(lote.map(async (p) => {
        const r = await fetch(`${API_BASE}/pedidos/vendas/${p.id}`, {
          headers: { Authorization: `Bearer ${accessToken}`, Accept: 'application/json' },
        });
        if (!r.ok) return null;
        const detalhe = (await r.json())?.data;
        return { pedido: p, itens: detalhe?.itens || [] };
      }));
      itensPorPedido.push(...detalhes.filter(Boolean));
    }
    return itensPorPedido;
  },

  mapItemVenda(pedido, item, subscriberId) {
    return {
      subscriber_id: subscriberId,
      provider: 'bling',
      pedido_erp_id: String(pedido.id),
      produto_erp_id: item.produto?.id ? String(item.produto.id) : null,
      produto_nome: item.descricao || `Item #${item.id}`,
      quantidade: Number(item.quantidade) || 0,
      valor: Number(item.valor) || 0,
      data: pedido.data || null,
    };
  },

  // Posição de caixa: o Bling não expõe saldo de conta financeira em nenhum
  // endpoint (confirmado no OpenAPI inteiro — só ContasFinanceirasDadosBasicosDTO,
  // que é só {id, descricao}). O jeito de chegar no saldo atual é somar
  // crédito menos débito de TODAS as movimentações de /caixas desde o
  // início da conta — não tem outro caminho. Uma página de cada vez (sem
  // paginar tudo aqui dentro) porque isso pode ser muita coisa pra uma
  // function só (ver sincronizarPosicaoCaixa em sync.js, que pagina aos
  // poucos e retoma na próxima chamada).
  async fetchPaginaCaixas({ accessToken }, { dataInicial, dataFinal, pagina, idContaFinanceira }) {
    const params = new URLSearchParams({
      pagina: String(pagina),
      limite: String(POR_PAGINA),
      dataInicial,
      dataFinal,
      situacao: 'R', // só lançamentos registrados, exclui excluídos
    });
    if (idContaFinanceira) params.set('idContaFinanceira', String(idContaFinanceira));
    const resp = await getComRetry429(`${API_BASE}/caixas?${params}`, accessToken);
    if (!resp.ok) throw new Error(`Bling /caixas falhou: ${resp.status} ${await resp.text()}`);
    return (await resp.json())?.data || [];
  },
};
