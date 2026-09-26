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

// Percorre todas as páginas de uma listagem do Bling (pagina=1,2,...) até vir
// uma página incompleta. Uma nova tentativa em 429 (limite de taxa) por página.
async function fetchTodasPaginas(caminho, accessToken, rotulo) {
  const todos = [];
  for (let pagina = 1; pagina <= MAX_PAGINAS; pagina++) {
    const url = `${API_BASE}${caminho}${caminho.includes('?') ? '&' : '?'}pagina=${pagina}&limite=${POR_PAGINA}`;
    const init = { headers: { Authorization: `Bearer ${accessToken}`, Accept: 'application/json' } };
    let resp = await fetch(url, init);
    if (resp.status === 429) {
      await new Promise((r) => setTimeout(r, 1200));
      resp = await fetch(url, init);
    }
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
  // contato, categoria ou histórico. Pra trazer o nome do contato seria
  // preciso um GET /contatos/{id} por lançamento (não implementado ainda,
  // por custo de N chamadas extra por sincronização).
  mapConta(conta, tipo, subscriberId) {
    // situacao: 1 Aberto, 2 Pago, 3 Parcial, 4 Devolvido, 5 Cancelado, 6 Devolvido parcial, 7 Confirmado
    const status = conta.situacao === 2 ? 'pago' : 'pendente';
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
      contraparte: conta.contato?.id ? `Contato Bling #${conta.contato.id}` : null,
      contraparte_telefone: null,
      erp_id: `bling:${conta.id}`,
    };
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
};
