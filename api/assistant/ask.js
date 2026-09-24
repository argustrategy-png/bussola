// POST /api/assistant/ask  { message: '...', history?: [{role,parts}] }
//
// Assistente com Gemini que responde perguntas sobre os lançamentos já
// sincronizados do usuário (tabela `lancamentos` no Supabase, alimentada
// pelo sync do ERP a cada hora) — nunca busca no ERP ao vivo. As
// ferramentas são só leitura e sempre escopadas ao subscriber_id vindo do
// JWT autenticado, nunca de algo que o cliente informa.
//
// Chama a API do Gemini via fetch puro (sem SDK) — o resto do MeuArgus
// (Supabase, Stripe) também é assim, sem nenhuma dependência npm no
// projeto. Requer a env var GEMINI_API_KEY na Vercel.
//
// Formato da API confirmado contra a documentação oficial (generateContent
// REST): contents[]/parts[], tools[0].functionDeclarations[], respostas de
// function call em candidates[0].content.parts[].functionCall, resultado
// devolvido como parts[].functionResponse com role 'user'.

import { getAuthenticatedSubscriber } from '../_lib/supabase.js';

const MODEL = 'gemini-3.8-flash';
const GEMINI_API = `https://generativelanguage.googleapis.com/v1beta/models/${MODEL}:generateContent`;
const MAX_RODADAS_FERRAMENTA = 5;

const TOOLS = [
  {
    functionDeclarations: [
      {
        name: 'buscar_lancamentos',
        description: 'Busca lançamentos financeiros (contas a pagar ou a receber) do usuário, com filtros opcionais. Use pra responder perguntas sobre contas específicas, categorias, clientes/fornecedores ou períodos.',
        parameters: {
          type: 'object',
          properties: {
            tipo: { type: 'string', enum: ['pagar', 'receber'], description: 'Filtra por tipo de lançamento.' },
            status: { type: 'string', enum: ['pago', 'pendente'], description: 'Filtra por status.' },
            categoria: { type: 'string', description: 'Filtra por categoria (busca parcial, sem diferenciar maiúsculas/minúsculas).' },
            contraparte: { type: 'string', description: 'Filtra por nome do cliente/fornecedor (busca parcial).' },
            vencimento_de: { type: 'string', description: 'Data mínima de vencimento, formato AAAA-MM-DD.' },
            vencimento_ate: { type: 'string', description: 'Data máxima de vencimento, formato AAAA-MM-DD.' },
            limite: { type: 'integer', description: 'Máximo de resultados (padrão 30, máximo 100).' },
          },
        },
      },
      {
        name: 'resumo_financeiro',
        description: 'Retorna um resumo financeiro atual: saldo em caixa, total a pagar e a receber nos próximos 30 dias, e contas vencidas. Use pra perguntas gerais sobre a saúde financeira do negócio.',
        parameters: { type: 'object', properties: {} },
      },
      {
        name: 'consultar_estoque',
        description: 'Consulta a posição de estoque dos produtos sincronizados do ERP (hoje só disponível pra quem usa Bling). Use pra perguntas sobre quantidade em estoque de um produto, ou quais produtos estão com estoque baixo.',
        parameters: {
          type: 'object',
          properties: {
            nome: { type: 'string', description: 'Filtra por nome do produto (busca parcial).' },
            apenas_estoque_baixo: { type: 'boolean', description: 'Se true, retorna só produtos com 5 unidades ou menos em estoque.' },
          },
        },
      },
      {
        name: 'produtos_mais_vendidos',
        description: 'Retorna o ranking de produtos/serviços que mais faturaram nos últimos 30 dias, ordenado por valor total (não por quantidade — quantidade não é comparável entre um contrato de serviço e um item avulso). Use pra perguntas sobre o que mais vendeu ou mais faturou.',
        parameters: {
          type: 'object',
          properties: {
            limite: { type: 'integer', description: 'Quantos produtos no ranking (padrão 5, máximo 20).' },
          },
        },
      },
    ],
  },
];

function today() { return new Date().toISOString().split('T')[0]; }
function addDays(dateStr, n) { const d = new Date(dateStr + 'T12:00:00'); d.setDate(d.getDate() + n); return d.toISOString().split('T')[0]; }

async function supabaseSelect(subscriberId, query, tabela = 'lancamentos') {
  const resp = await fetch(
    `${process.env.SUPABASE_URL}/rest/v1/${tabela}?subscriber_id=eq.${subscriberId}&${query}`,
    { headers: { apikey: process.env.SUPABASE_SERVICE_ROLE_KEY, Authorization: `Bearer ${process.env.SUPABASE_SERVICE_ROLE_KEY}` } }
  );
  if (!resp.ok) throw new Error(`Supabase query falhou: ${resp.status} ${await resp.text()}`);
  return resp.json();
}

async function executarFerramenta(nome, input, subscriberId) {
  if (nome === 'buscar_lancamentos') {
    const params = ['select=tipo,descricao,valor,vencimento,categoria,status,contraparte,toc'];
    if (input.tipo) params.push(`tipo=eq.${encodeURIComponent(input.tipo)}`);
    if (input.status) params.push(`status=eq.${encodeURIComponent(input.status)}`);
    if (input.categoria) params.push(`categoria=ilike.*${encodeURIComponent(input.categoria)}*`);
    if (input.contraparte) params.push(`contraparte=ilike.*${encodeURIComponent(input.contraparte)}*`);
    if (input.vencimento_de) params.push(`vencimento=gte.${encodeURIComponent(input.vencimento_de)}`);
    if (input.vencimento_ate) params.push(`vencimento=lte.${encodeURIComponent(input.vencimento_ate)}`);
    const limite = Math.min(Number(input.limite) || 30, 100);
    params.push(`limit=${limite}`, 'order=vencimento.asc');
    const rows = await supabaseSelect(subscriberId, params.join('&'));
    return { total_encontrado: rows.length, lancamentos: rows };
  }
  if (nome === 'resumo_financeiro') {
    const t = today(), t30 = addDays(t, 30);
    const pagos = await supabaseSelect(subscriberId, 'select=tipo,valor&status=eq.pago');
    const saldo = pagos.reduce((s, r) => s + (r.tipo === 'receber' ? r.valor : -r.valor), 0);
    const proximos = await supabaseSelect(subscriberId, `select=tipo,valor,vencimento&status=eq.pendente&vencimento=gte.${t}&vencimento=lte.${t30}`);
    const aReceber30d = proximos.filter(r => r.tipo === 'receber').reduce((s, r) => s + r.valor, 0);
    const aPagar30d = proximos.filter(r => r.tipo === 'pagar').reduce((s, r) => s + r.valor, 0);
    const vencidos = await supabaseSelect(subscriberId, `select=tipo,valor&status=eq.pendente&vencimento=lt.${t}`);
    const vencidoPagar = vencidos.filter(r => r.tipo === 'pagar').reduce((s, r) => s + r.valor, 0);
    const vencidoReceber = vencidos.filter(r => r.tipo === 'receber').reduce((s, r) => s + r.valor, 0);
    return {
      data_hoje: t,
      saldo_atual: saldo,
      a_receber_proximos_30_dias: aReceber30d,
      a_pagar_proximos_30_dias: aPagar30d,
      vencido_a_pagar: vencidoPagar,
      vencido_a_receber: vencidoReceber,
    };
  }
  if (nome === 'consultar_estoque') {
    const params = ['select=nome,codigo,estoque_atual,preco,situacao'];
    if (input.nome) params.push(`nome=ilike.*${encodeURIComponent(input.nome)}*`);
    if (input.apenas_estoque_baixo) params.push('estoque_atual=lte.5');
    params.push('order=estoque_atual.asc', 'limit=50');
    const produtos = await supabaseSelect(subscriberId, params.join('&'), 'produtos');
    if (!produtos.length) return { total_encontrado: 0, aviso: 'Nenhum produto sincronizado — só disponível pra quem tem Bling conectado.' };
    return { total_encontrado: produtos.length, produtos };
  }
  if (nome === 'produtos_mais_vendidos') {
    const itens = await supabaseSelect(subscriberId, 'select=produto_nome,quantidade,valor', 'vendas_itens');
    if (!itens.length) return { aviso: 'Nenhuma venda sincronizada nos últimos 30 dias — só disponível pra quem tem Bling conectado.' };
    const porProduto = {};
    itens.forEach((item) => {
      const chave = item.produto_nome;
      if (!porProduto[chave]) porProduto[chave] = { produto: chave, quantidade_total: 0, valor_total: 0 };
      porProduto[chave].quantidade_total += Number(item.quantidade) || 0;
      porProduto[chave].valor_total += Number(item.valor) || 0;
    });
    const limite = Math.min(Number(input.limite) || 5, 20);
    // Ordenado por faturamento, não por quantidade: pra negócio de serviço,
    // "mais vendido" por unidade não faz sentido (uma consultoria e uma
    // locação avulsa não são comparáveis por contagem) — o que importa é
    // quem contribuiu mais em receita.
    const ranking = Object.values(porProduto).sort((a, b) => b.valor_total - a.valor_total).slice(0, limite);
    return { periodo: 'últimos 30 dias', ordenado_por: 'faturamento (valor_total)', ranking };
  }
  throw new Error(`Ferramenta desconhecida: ${nome}`);
}

async function chamarGemini(contents) {
  const resp = await fetch(GEMINI_API, {
    method: 'POST',
    headers: {
      'x-goog-api-key': process.env.GEMINI_API_KEY,
      'content-type': 'application/json',
    },
    body: JSON.stringify({
      contents,
      tools: TOOLS,
      systemInstruction: {
        parts: [{ text: 'Você é o assistente financeiro do MeuArgus. Responda em português, de forma direta e objetiva, com valores formatados em R$. Use as ferramentas disponíveis pra buscar os dados reais do usuário antes de responder — nunca invente números. Se a busca não encontrar nada, diga isso claramente em vez de supor.' }],
      },
    }),
  });
  if (!resp.ok) throw new Error(`Gemini API falhou: ${resp.status} ${await resp.text()}`);
  return resp.json();
}

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'method_not_allowed' });

  const subscriberId = await getAuthenticatedSubscriber(req);
  if (!subscriberId) return res.status(401).json({ error: 'não autenticado' });

  const { message, history } = req.body || {};
  if (!message || typeof message !== 'string') return res.status(400).json({ error: 'message obrigatório' });

  try {
    const contents = [...(Array.isArray(history) ? history : []), { role: 'user', parts: [{ text: message }] }];

    for (let rodada = 0; rodada < MAX_RODADAS_FERRAMENTA; rodada++) {
      const data = await chamarGemini(contents);
      const candidato = data.candidates?.[0];
      const parts = candidato?.content?.parts || [];
      contents.push({ role: 'model', parts });

      const chamadasFuncao = parts.filter((p) => p.functionCall);
      if (chamadasFuncao.length === 0) {
        const texto = parts.filter((p) => p.text).map((p) => p.text).join('\n');
        return res.status(200).json({ reply: texto, history: contents });
      }

      const resultados = await Promise.all(chamadasFuncao.map(async (p) => {
        const { name, args } = p.functionCall;
        try {
          const resultado = await executarFerramenta(name, args || {}, subscriberId);
          return { functionResponse: { name, response: resultado } };
        } catch (err) {
          return { functionResponse: { name, response: { erro: String(err.message || err) } } };
        }
      }));
      contents.push({ role: 'user', parts: resultados });
    }

    return res.status(500).json({ error: 'muitas_rodadas_de_ferramentas' });
  } catch (err) {
    console.error('assistant ask error', err);
    return res.status(500).json({ error: 'assistant_failed', detail: String(err.message || err) });
  }
}
