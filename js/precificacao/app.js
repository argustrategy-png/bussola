// Tela da Precificação. Dados no Supabase (tabelas pr_*, ver
// supabase-migration-precificacao.sql), protegidos por RLS: só o dono vê, e só
// com o módulo liberado pelo admin. Cálculos em js/precificacao/calculo.js.

const $ = (id) => document.getElementById(id);
const brl = (v) => (Number.isFinite(v) ? v.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' }) : '—');
const num = (v, d = 2) => (Number.isFinite(v) ? v.toLocaleString('pt-BR', { minimumFractionDigits: d, maximumFractionDigits: d }) : '—');
const pc = (v, d = 1) => (Number.isFinite(v) ? num(v, d) + '%' : '—');
const paraCampo = (v) => (v == null || v === '' || !Number.isFinite(Number(v)) ? '' : String(+Number(v).toFixed(6)).replace('.', ','));
const UNIDADE_USO = { g: 'g', ml: 'ml', un: 'un' };
// Custo de insumo legível: por kg/L em vez de "R$ 0,01 / ml".
function custoLegivel(i) {
  const cu = PR.custoUnitarioInsumo(i);
  if (i.unidade === 'un') return `${brl(cu)}/un`;
  return `${brl(cu * 1000)}/${i.unidade === 'ml' ? 'L' : 'kg'}`;
}

const CFG_PADRAO = {
  un: 'litro', folha: '', enc: '70', energia: '', equip: '', vida: '10', outros: '', cap: '',
  manual: false, manualV: '', fixas: '', fat: '', ohManual: false, ohV: '',
};
const PRODUTO_NOVO = () => ({ id: null, nome: '', receita_id: '', qtd: '1', mpManual: '0', emb: '0', imp: '8', fr: '0', com: '0', lu: '15', preco: '' });

const S = {
  user: null, aba: 'precificar', modo: 'sug',
  insumos: [], historico: {}, receitas: [], itens: [], produtos: [], cfg: { ...CFG_PADRAO },
  atual: PRODUTO_NOVO(), receitaSel: null, buscaInsumo: '', buscaReceita: '',
};

// ─── DADOS ───────────────────────────────────────────────
async function carregarTudo() {
  const [ins, hist, rec, itens, prod, cfg] = await Promise.all([
    sb.from('pr_insumos').select('*').order('nome'),
    sb.from('pr_insumo_precos').select('insumo_id,preco,conteudo,data').order('data'),
    sb.from('pr_receitas').select('*').order('nome'),
    sb.from('pr_receita_itens').select('*'),
    sb.from('pr_produtos').select('*').order('nome'),
    sb.from('pr_config').select('dados').maybeSingle(),
  ]);
  const erro = [ins, hist, rec, itens, prod, cfg].find((r) => r.error);
  if (erro) throw erro.error;
  S.insumos = ins.data || [];
  S.historico = {};
  (hist.data || []).forEach((h) => (S.historico[h.insumo_id] ||= []).push(h));
  S.receitas = rec.data || [];
  S.itens = itens.data || [];
  S.produtos = prod.data || [];
  S.cfg = { ...CFG_PADRAO, ...(cfg.data?.dados || {}) };
}

const mapaInsumos = () => new Map(S.insumos.map((i) => [i.id, i]));
function custoDaReceita(receitaId) {
  const r = S.receitas.find((x) => x.id === receitaId);
  if (!r) return null;
  return PR.custoReceita(r, S.itens.filter((i) => i.receita_id === receitaId), mapaInsumos());
}
// Custo de matéria-prima do produto: pela receita (custo por unidade × quantidade) ou digitado.
function mpDoProduto(p) {
  if (p.receita_id) {
    const c = custoDaReceita(p.receita_id);
    return c ? c.porUnidade * PR.val(p.qtd) : NaN;
  }
  return PR.val(p.mpManual);
}
const calcProduto = (p) => PR.preco({ ...p, mp: mpDoProduto(p) }, S.cfg);

const timers = {};
function salvarDepois(chave, fn, ms = 600) {
  clearTimeout(timers[chave]);
  timers[chave] = setTimeout(async () => {
    const { error } = await fn();
    if (error) toast('Não foi possível salvar: ' + error.message, true);
  }, ms);
}
function toast(msg, erro) {
  const t = $('pr-toast');
  t.textContent = msg; t.className = 'pr-toast on' + (erro ? ' err' : '');
  clearTimeout(toast.h); toast.h = setTimeout(() => (t.className = 'pr-toast'), erro ? 4500 : 2000);
}

// ─── COMPONENTES ─────────────────────────────────────────
function caixa(attrs, { pre, suf, valor = '' } = {}) {
  return `<div><div class="pr-box">${pre ? `<span>${pre}</span>` : ''}<input inputmode="decimal" ${attrs} value="${escapeHtml(valor)}">${suf ? `<span>${escapeHtml(suf)}</span>` : ''}</div><div class="pr-calc" data-eq></div></div>`;
}
const linha = (lbl, hint, inner, cor) => `<div class="pr-line"><div class="lb">${cor ? `<i class="pr-dot" style="background:${cor}"></i>` : ''}${lbl}${hint ? `<small>${hint}</small>` : ''}</div>${inner}</div>`;
const CORES = { mp: '#2563EB', emb: '#60A5FA', tr: '#93C5FD', imp: '#C2760C', fr: '#E5A84B', com: '#F2CF94', oh: '#94A3B8', lu: '#16A34A' };
function pill(m, meta) {
  if (!Number.isFinite(m)) return '—';
  const cls = m < 0 ? 'pr-bad' : m < meta ? 'pr-warn' : 'pr-good';
  return `<span class="pill ${cls}">${pc(m)}</span>`;
}
function variacaoPill(v) {
  if (!Number.isFinite(v) || Math.abs(v) < 0.05) return '<span class="pr-sub">—</span>';
  return `<span class="pill ${v > 0 ? 'pr-bad' : 'pr-good'}">${v > 0 ? '▲' : '▼'} ${pc(Math.abs(v))}</span>`;
}

// ─── ABA PRECIFICAR ──────────────────────────────────────
function abaPrecificar() {
  const p = S.atual, c = S.cfg;
  const opcoesReceita = S.receitas.map((r) => `<option value="${r.id}" ${r.id === p.receita_id ? 'selected' : ''}>${escapeHtml(r.nome)}</option>`).join('');
  const rec = S.receitas.find((r) => r.id === p.receita_id);
  const salvos = S.produtos.length
    ? `<div class="pr-scroll"><table class="pr-table"><thead><tr><th>Produto</th><th class="r">Custo</th><th class="r">Preço</th><th class="r">Margem</th><th></th></tr></thead><tbody>
      ${S.produtos.map((x) => { const r = calcProduto(x.dados); const m = r.margemNoPreco(x.preco_precificado);
        return `<tr class="cl ${x.id === p.id ? 'on' : ''}" data-abrir="${x.id}"><td><b>${escapeHtml(x.nome)}</b></td><td class="r">${brl(r.custo)}</td><td class="r">${brl(x.preco_precificado)}</td><td class="r">${pill(m, PR.val(x.dados.lu))}</td>
          <td class="r"><button class="pr-x" data-del-produto="${x.id}" title="Excluir">✕</button></td></tr>`; }).join('')}
      </tbody></table></div>`
    : `<p class="pr-empty">Nenhum preço salvo ainda.</p>`;
  return `<div class="pr-grid"><div>
    <div class="pr-card">
      <input class="pr-nome" data-p="nome" value="${escapeHtml(p.nome)}" placeholder="O que você vai precificar? (ex.: Pote 2 litros)">
      <h3><span class="pr-n">1</span>Quanto custa fazer</h3>
      <p class="pr-hint">Para uma unidade vendida.</p>
      ${linha('Receita', 'de onde vem o custo da matéria-prima', `<div class="pr-box"><select data-p="receita_id"><option value="">Digitar o custo à mão</option>${opcoesReceita}</select></div>`, CORES.mp)}
      ${p.receita_id
        ? linha('Quantidade da receita', `custo da receita: ${brl(custoDaReceita(p.receita_id)?.porUnidade)} por ${escapeHtml(rec?.unidade || 'unidade')}`, caixa('data-p="qtd"', { valor: p.qtd, suf: rec?.unidade || 'un' }))
        : linha('Matéria-prima', 'insumos usados nesta unidade', caixa('data-p="mpManual"', { valor: p.mpManual, pre: 'R$' }))}
      ${!p.receita_id ? linha('Quantidade produzida', `para o custo de fábrica (${escapeHtml(c.un)})`, caixa('data-p="qtd"', { valor: p.qtd, suf: c.un })) : ''}
      ${linha('Embalagem', 'pote, caixa, rótulo', caixa('data-p="emb"', { valor: p.emb, pre: 'R$' }), CORES.emb)}
      ${linha('Custo de fábrica', 'mão de obra, energia e máquinas', `<div class="pr-row"><button class="pr-chip" data-act="fab"><span data-o="fabV"></span> / ${escapeHtml(c.un)} ✎</button></div>`, CORES.tr)}
      <div class="pr-tot"><span>Custo total</span><b data-o="custo"></b></div>
    </div>
    <div class="pr-card">
      <h3><span class="pr-n">2</span>O que sai do preço</h3>
      <p class="pr-hint">Percentuais sobre o valor de venda.</p>
      ${linha('Impostos', 'Simples, ICMS, ISS…', caixa('data-p="imp"', { valor: p.imp, suf: '%' }), CORES.imp)}
      ${linha('Frete', 'entrega ao cliente', caixa('data-p="fr"', { valor: p.fr, suf: '%' }), CORES.fr)}
      ${linha('Comissão', 'vendedor, representante', caixa('data-p="com"', { valor: p.com, suf: '%' }), CORES.com)}
      ${linha('Despesas fixas', 'aluguel, pró-labore, escritório', `<div class="pr-row"><button class="pr-chip" data-act="oh"><span data-o="ohV"></span> ✎</button></div>`, CORES.oh)}
      ${linha(S.modo === 'test' ? 'Lucro desejado (meta)' : 'Lucro desejado', 'o que sobra limpo', caixa('data-p="lu"', { valor: p.lu, suf: '%' }), CORES.lu)}
      <div data-o="soma" class="pr-sub" style="margin-top:8px"></div>
    </div>
    <div class="pr-card">
      <h3>Preços salvos</h3>
      <p class="pr-hint">Clique para abrir. A aba Margens mostra quanto cada um perdeu com a alta dos insumos.</p>
      ${salvos}
    </div>
  </div>
  <aside class="pr-card pr-res">
    <div class="pr-seg"><button data-modo="sug" class="${S.modo === 'sug' ? 'on' : ''}">Quero o preço</button><button data-modo="test" class="${S.modo === 'test' ? 'on' : ''}">Já tenho um preço</button></div>
    ${S.modo === 'sug'
      ? `<div class="pr-lbl">Preço de venda sugerido</div><div class="pr-price" data-o="preco"></div><div class="pr-sub" data-o="precoSub"></div>`
      : `<div class="pr-lbl">Seu preço de venda</div><div class="pr-bigin"><span>R$</span><input inputmode="decimal" data-p="preco" value="${escapeHtml(p.preco)}" placeholder="0,00"></div><div data-o="verd"></div>`}
    <div class="pr-lbl">Para onde vai o dinheiro</div>
    <div data-o="split"></div>
    <div class="pr-acts"><button class="btn btn-primary" data-act="salvar-produto">${p.id ? 'Atualizar preço' : 'Salvar preço'}</button><button class="btn btn-sec" data-act="novo-produto">Novo</button></div>
  </aside></div>`;
}

function atualizarPrecificar() {
  const p = S.atual, r = calcProduto(p);
  const set = (k, v, html) => { const el = document.querySelector(`[data-o="${k}"]`); if (el) el[html ? 'innerHTML' : 'textContent'] = v; };
  set('fabV', brl(r.F.v));
  set('ohV', pc(r.oh));
  set('custo', brl(r.custo));
  set('soma', `Saem do preço <b>${pc(r.soma)}</b> · sobra para o custo <b>${pc(100 - r.soma)}</b>${r.soma >= 100 ? ' — <span style="color:var(--red)">passou de 100%: nenhum preço cobre isso</span>' : ''}`, true);
  set('preco', brl(r.sugerido));
  set('precoSub', Number.isFinite(r.sugerido) ? `Mark-up <b>×${num(r.mk)}</b> · lucro de <b>${brl(r.sugerido * r.lu / 100)}</b> por venda` : 'Ajuste os percentuais.', true);
  if (S.modo === 'test') {
    let h = '';
    if (r.pr > 0) {
      const m = r.margemReal, cls = m < 0 ? 'pr-bad' : m < r.lu ? 'pr-warn' : 'pr-good';
      h = `<div class="pr-verd ${cls}"><b>${pc(m)} de lucro</b><p>${brl(r.pr * m / 100)} por venda · ${m < 0 ? 'você perde dinheiro a cada venda' : m < r.lu ? `abaixo da meta de ${pc(r.lu)}` : 'na meta ou acima'}</p></div>`;
    }
    set('verd', h + `<div class="pr-sub" style="margin-top:8px">Para lucrar ${pc(r.lu)}, cobre <b>${brl(r.sugerido)}</b></div>`, true);
  }
  const P = S.modo === 'test' ? r.pr : r.sugerido;
  if (P > 0) {
    const segs = [['Matéria-prima', r.mp, CORES.mp], ['Embalagem', r.emb, CORES.emb], ['Custo de fábrica', r.tr, CORES.tr], ['Impostos', P * r.imp / 100, CORES.imp],
      ['Frete', P * r.fr / 100, CORES.fr], ['Comissão', P * r.com / 100, CORES.com], ['Despesas fixas', P * r.oh / 100, CORES.oh]];
    const gastos = segs.reduce((a, s) => a + (s[1] || 0), 0), lucro = P - gastos, tot = Math.max(P, gastos);
    const todos = segs.concat([[lucro < 0 ? 'Prejuízo' : 'Lucro', lucro, lucro < 0 ? 'var(--red)' : CORES.lu]]).filter((s) => Math.abs(s[1]) > 0.004);
    set('split', `<div class="pr-split">${todos.filter((s) => s[1] > 0).map(([, v, cor]) => `<i style="width:${(v / tot) * 100}%;background:${cor}"></i>`).join('')}</div>
      <div class="pr-where">${todos.map(([l, v, cor]) => `<div><span><i class="pr-dot" style="background:${cor}"></i>${l}</span><b>${brl(v)}</b><em>${pc((v / P) * 100, 0)}</em></div>`).join('')}</div>`, true);
  } else set('split', '<p class="pr-empty">Digite um preço para ver a divisão.</p>', true);
  atualizarEquivalencias();
}

async function salvarProduto() {
  const p = S.atual, r = calcProduto(p);
  const preco = S.modo === 'test' && r.pr > 0 ? r.pr : r.sugerido;
  if (!p.nome.trim()) { toast('Dê um nome ao produto antes de salvar.', true); $('pr-conteudo').querySelector('.pr-nome')?.focus(); return; }
  if (!Number.isFinite(preco)) { toast('Ajuste os percentuais: o preço não pôde ser calculado.', true); return; }
  const { id, ...dados } = p;
  const registro = {
    subscriber_id: S.user.id, nome: p.nome.trim(), receita_id: p.receita_id || null, dados: { ...dados, preco: paraCampo(preco) },
    custo_precificado: r.custo, preco_precificado: preco, margem_precificada: r.margemNoPreco(preco),
    precificado_em: new Date().toISOString(), updated_at: new Date().toISOString(),
  };
  const q = id ? sb.from('pr_produtos').update(registro).eq('id', id).select().single() : sb.from('pr_produtos').insert(registro).select().single();
  const { data, error } = await q;
  if (error) { toast('Erro ao salvar: ' + error.message, true); return; }
  S.produtos = S.produtos.filter((x) => x.id !== data.id).concat(data).sort((a, b) => a.nome.localeCompare(b.nome));
  S.atual = { ...data.dados, id: data.id, nome: data.nome };
  toast(id ? 'Preço atualizado ✓' : 'Preço salvo ✓');
  render();
}

// ─── ABA MARGENS ─────────────────────────────────────────
function abaMargens() {
  if (!S.produtos.length) return `<div class="pr-card pr-empty">Salve preços na aba Precificar para acompanhar as margens aqui.</div>`;
  const linhas = S.produtos.map((x) => {
    const r = calcProduto(x.dados);
    const mHoje = r.margemNoPreco(x.preco_precificado), mAntes = Number(x.margem_precificada);
    const dCusto = x.custo_precificado > 0 ? (r.custo / x.custo_precificado - 1) * 100 : NaN;
    return { x, r, mHoje, mAntes, queda: mHoje - mAntes, dCusto, meta: PR.val(x.dados.lu) };
  }).sort((a, b) => (a.queda || 0) - (b.queda || 0));
  const abaixo = linhas.filter((l) => l.mHoje < l.meta).length;
  const quedaMedia = linhas.reduce((s, l) => s + (Number.isFinite(l.queda) ? l.queda : 0), 0) / linhas.length;
  const subiram = S.insumos.map((i) => ({ i, v: PR.variacao(S.historico[i.id], 90) })).filter((o) => o.v > 0.05).sort((a, b) => b.v - a.v).slice(0, 6);
  return `<div class="pr-kpis">
      <div class="pr-kpi"><div class="l">Preços acompanhados</div><div class="v">${linhas.length}</div></div>
      <div class="pr-kpi"><div class="l">Abaixo da meta de lucro</div><div class="v" style="color:${abaixo ? 'var(--red)' : 'var(--green)'}">${abaixo}</div></div>
      <div class="pr-kpi"><div class="l">Variação média da margem</div><div class="v" style="color:${quedaMedia < -0.05 ? 'var(--red)' : 'var(--text)'}">${quedaMedia > 0 ? '+' : ''}${num(quedaMedia, 1)} p.p.</div></div>
    </div>
    <div class="pr-card"><h3>Margem quando precificou × margem hoje</h3>
      <p class="pr-hint">Mesmo preço de venda, com o custo de hoje dos insumos, do custo de fábrica e das despesas fixas. Os que mais perderam aparecem primeiro.</p>
      <div class="pr-scroll"><table class="pr-table"><thead><tr><th>Produto</th><th class="r">Preço</th><th class="r">Custo antes → hoje</th><th class="r">Margem antes</th><th class="r">Margem hoje</th><th class="r">Preço p/ voltar à meta</th><th></th></tr></thead><tbody>
      ${linhas.map((l) => `<tr><td><b>${escapeHtml(l.x.nome)}</b><div class="pr-sub">precificado em ${new Date(l.x.precificado_em).toLocaleDateString('pt-BR')}</div></td>
        <td class="r">${brl(l.x.preco_precificado)}</td>
        <td class="r">${brl(l.x.custo_precificado)} → ${brl(l.r.custo)} ${variacaoPill(l.dCusto)}</td>
        <td class="r">${pc(l.mAntes)}</td><td class="r">${pill(l.mHoje, l.meta)}</td>
        <td class="r"><b>${l.mHoje < l.meta ? brl(l.r.sugerido) : '—'}</b></td>
        <td class="r"><button class="btn btn-sec" style="padding:5px 10px" data-abrir="${l.x.id}">Abrir</button></td></tr>`).join('')}
      </tbody></table></div></div>
    <div class="pr-card"><h3>Insumos que mais subiram (90 dias)</h3>
      ${subiram.length ? `<table class="pr-table"><tbody>${subiram.map((o) => `<tr><td>${escapeHtml(o.i.nome)}</td><td class="r">${custoLegivel(o.i)}</td><td class="r">${variacaoPill(o.v)}</td></tr>`).join('')}</tbody></table>`
        : '<p class="pr-empty">Nenhum insumo subiu nos últimos 90 dias. Atualize os preços na aba Insumos quando comprar.</p>'}</div>`;
}

// ─── ABA RECEITAS ────────────────────────────────────────
function abaReceitas() {
  const termo = S.buscaReceita.toLowerCase();
  const lista = S.receitas.filter((r) => r.nome.toLowerCase().includes(termo));
  if (S.receitaSel && !S.receitas.some((r) => r.id === S.receitaSel)) S.receitaSel = null;
  const r = S.receitas.find((x) => x.id === S.receitaSel);
  let editor = `<div class="pr-card pr-empty">${S.receitas.length ? 'Escolha uma receita ao lado.' : 'Cadastre os insumos primeiro, depois crie a primeira receita.'}</div>`;
  if (r) {
    const c = custoDaReceita(r.id);
    const opcoes = (sel) => `<option value="">Escolha o insumo…</option>` + S.insumos.map((i) => `<option value="${i.id}" ${i.id === sel ? 'selected' : ''}>${escapeHtml(i.nome)}</option>`).join('');
    editor = `<div class="pr-card">
      <input class="pr-nome" data-receita="nome" value="${escapeHtml(r.nome)}" placeholder="Nome da receita">
      <div class="pr-row" style="justify-content:flex-start;gap:14px;margin-bottom:12px">
        <label class="pr-sub">Rendimento <div class="pr-box" style="width:200px;margin-top:4px"><input inputmode="decimal" data-receita="rendimento" value="${escapeHtml(paraCampo(r.rendimento))}"><span>
          <select data-receita="unidade" style="text-align:left;padding:0;font-size:.75rem">${['litro', 'kg', 'un'].map((u) => `<option ${u === r.unidade ? 'selected' : ''}>${u}</option>`).join('')}</select></span></div></label>
      </div>
      <div class="pr-scroll"><table class="pr-table"><thead><tr><th>Ingrediente</th><th class="r" style="width:120px">Quantidade</th><th class="r" style="width:110px">Custo</th><th style="width:34px"></th></tr></thead><tbody>
        ${c.linhas.map((l) => `<tr><td><select data-item="${l.id}" data-campo="insumo_id">${opcoes(l.insumo_id)}</select></td>
          <td><div style="display:flex;align-items:center;gap:4px"><input class="n" inputmode="decimal" data-item="${l.id}" data-campo="quantidade" value="${escapeHtml(paraCampo(l.quantidade))}"><span class="pr-sub">${UNIDADE_USO[l.insumo?.unidade] || ''}</span></div></td>
          <td class="r" data-o="item-${l.id}">${brl(l.custo)}</td><td><button class="pr-x" data-del-item="${l.id}" title="Remover">✕</button></td></tr>`).join('')}
        <tr><td colspan="4"><select data-novo-item><option value="">+ Adicionar ingrediente…</option>${S.insumos.map((i) => `<option value="${i.id}">${escapeHtml(i.nome)}</option>`).join('')}</select></td></tr>
      </tbody></table></div>
      <div class="pr-tot"><span>Custo da receita</span><b data-o="rec-total">${brl(c.total)}</b></div>
      <div class="pr-row" style="justify-content:space-between;margin-top:8px"><span class="pr-sub">Custo por ${escapeHtml(r.unidade)}</span><b data-o="rec-unidade" style="font-size:1.1rem">${brl(c.porUnidade)}</b></div>
      <div class="pr-row" style="justify-content:space-between;margin-top:16px"><button class="btn btn-sec" data-act="precificar-receita">Precificar esta receita →</button><button class="pr-x" data-act="del-receita">Excluir receita</button></div>
    </div>`;
  }
  return `<div class="pr-rec">
    <div class="pr-card"><div class="pr-toolbar" style="margin-bottom:8px"><input class="pr-busca" style="min-width:0;width:100%" data-busca="receita" value="${escapeHtml(S.buscaReceita)}" placeholder="Buscar receita…"></div>
      <button class="btn btn-primary" style="width:100%;margin-bottom:8px" data-act="nova-receita">+ Nova receita</button>
      <div class="pr-lista">${lista.map((x) => `<button data-receita-sel="${x.id}" class="${x.id === S.receitaSel ? 'on' : ''}"><span>${escapeHtml(x.nome)}</span><small>${brl(custoDaReceita(x.id).porUnidade)}/${escapeHtml(x.unidade)}</small></button>`).join('') || '<p class="pr-empty">Nenhuma receita.</p>'}</div>
    </div>${editor}</div>`;
}

function atualizarReceita() {
  const r = S.receitas.find((x) => x.id === S.receitaSel); if (!r) return;
  const c = custoDaReceita(r.id);
  c.linhas.forEach((l) => { const el = document.querySelector(`[data-o="item-${l.id}"]`); if (el) el.textContent = brl(l.custo); });
  const t = document.querySelector('[data-o="rec-total"]'); if (t) t.textContent = brl(c.total);
  const u = document.querySelector('[data-o="rec-unidade"]'); if (u) u.textContent = brl(c.porUnidade);
}

// ─── ABA INSUMOS ─────────────────────────────────────────
function abaInsumos() {
  const termo = S.buscaInsumo.toLowerCase();
  const lista = S.insumos.filter((i) => i.nome.toLowerCase().includes(termo) || (i.fornecedor || '').toLowerCase().includes(termo));
  return `<div class="pr-card">
    <div class="pr-toolbar"><div><h3>Insumos</h3><p class="pr-hint" style="margin:2px 0 0">Preço de compra de cada insumo. Ao mudar o preço, o histórico guarda o anterior e as receitas se recalculam.</p></div>
      <div class="pr-row"><input class="pr-busca" data-busca="insumo" value="${escapeHtml(S.buscaInsumo)}" placeholder="Buscar insumo ou fornecedor…"><button class="btn btn-primary" data-act="novo-insumo">+ Novo insumo</button></div></div>
    <div class="pr-scroll"><table class="pr-table"><thead><tr><th>Insumo</th><th style="width:70px">Usa em</th><th class="r" style="width:120px">Embalagem tem</th><th class="r" style="width:120px">Preço pago</th><th class="r" style="width:90px">Aproveit.</th><th class="r" style="width:120px">Custo útil</th><th class="r" style="width:90px">90 dias</th><th style="width:150px">Fornecedor</th><th style="width:34px"></th></tr></thead><tbody>
      ${lista.map((i) => `<tr>
        <td><input data-ins="${i.id}" data-campo="nome" value="${escapeHtml(i.nome)}"></td>
        <td><select data-ins="${i.id}" data-campo="unidade">${Object.keys(UNIDADE_USO).map((u) => `<option ${u === i.unidade ? 'selected' : ''}>${u}</option>`).join('')}</select></td>
        <td><input class="n" inputmode="decimal" data-ins="${i.id}" data-campo="conteudo" value="${escapeHtml(paraCampo(i.conteudo))}"></td>
        <td><input class="n" inputmode="decimal" data-ins="${i.id}" data-campo="preco" value="${escapeHtml(paraCampo(i.preco))}"></td>
        <td><input class="n" inputmode="decimal" data-ins="${i.id}" data-campo="aproveitamento" value="${escapeHtml(paraCampo(i.aproveitamento))}"></td>
        <td class="r" data-o="cu-${i.id}">${custoLegivel(i)}</td>
        <td class="r">${variacaoPill(PR.variacao(S.historico[i.id], 90))}</td>
        <td><input data-ins="${i.id}" data-campo="fornecedor" value="${escapeHtml(i.fornecedor || '')}" placeholder="—"></td>
        <td><button class="pr-x" data-del-insumo="${i.id}" title="Excluir">✕</button></td></tr>`).join('') || `<tr><td colspan="9" class="pr-empty">${S.insumos.length ? 'Nada encontrado.' : 'Cadastre o primeiro insumo. Ex.: Leite · ml · 12000 · R$ 54,00 (uma caixa com 12 litros).'}</td></tr>`}
    </tbody></table></div></div>`;
}

// ─── PAINÉIS LATERAIS (custo de fábrica, despesas fixas) ─
let DR = null;
function abrirPainel(tipo) {
  DR = tipo; const c = S.cfg;
  const cx = (k, o = {}) => caixa(`data-cfg="${k}"`, { ...o, valor: c[k] });
  const corpo = tipo === 'fab'
    ? `<div class="pr-dh"><div><h3>Custo de fábrica por ${escapeHtml(c.un)}</h3><p>Quanto custa produzir 1 ${escapeHtml(c.un)} — valores do mês.</p></div><button class="pr-x" data-act="fechar">✕</button></div>
      <div class="pr-db"><div class="pr-tip">Pode digitar contas: <b>3000+2500</b> ou <b>150*22</b>.</div>
        ${linha('Unidade', 'litro, kg, unidade…', `<div class="pr-box"><input data-cfg="un" value="${escapeHtml(c.un)}" style="text-align:left"></div>`)}
        ${linha('Produção por mês', 'capacidade por dia × dias', cx('cap', { suf: c.un }))}
        ${linha('Salários da produção', 'soma dos salários', cx('folha', { pre: 'R$' }))}
        ${linha('Encargos', 'sobre o salário', cx('enc', { suf: '%' }))}
        ${linha('Energia', 'só da produção', cx('energia', { pre: 'R$' }))}
        ${linha('Máquinas e equipamentos', 'valor de compra', cx('equip', { pre: 'R$' }))}
        ${linha('Vida útil', 'para o desgaste', cx('vida', { suf: 'anos' }))}
        ${linha('Outros gastos', 'manutenção, água, gás…', cx('outros', { pre: 'R$' }))}
        <div data-o="dr-det"></div>
        <label class="pr-chk"><input type="checkbox" data-cfg-cb="manual" ${c.manual ? 'checked' : ''}> Já sei o valor, quero digitar direto</label>
        ${c.manual ? linha('Valor por ' + escapeHtml(c.un), '', cx('manualV', { pre: 'R$' })) : ''}</div>`
    : `<div class="pr-dh"><div><h3>Despesas fixas</h3><p>Custos que existem mesmo sem vender — viram % do preço.</p></div><button class="pr-x" data-act="fechar">✕</button></div>
      <div class="pr-db"><div class="pr-tip">Some tudo que não é produção: aluguel, pró-labore, contador, marketing… Ex.: <b>3000+3500+10000</b>.</div>
        ${linha('Despesas fixas por mês', 'administrativo, vendas', cx('fixas', { pre: 'R$' }))}
        ${linha('Faturamento médio por mês', 'média de vários meses', cx('fat', { pre: 'R$' }))}
        <div data-o="dr-det"></div>
        <label class="pr-chk"><input type="checkbox" data-cfg-cb="ohManual" ${c.ohManual ? 'checked' : ''}> Já sei o %, quero digitar direto</label>
        ${c.ohManual ? linha('Despesas fixas', '', cx('ohV', { suf: '%' })) : ''}</div>`;
  $('pr-drawer').innerHTML = corpo + `<div class="pr-df"><div class="pr-row" style="justify-content:space-between"><b>${tipo === 'fab' ? 'Custo por ' + escapeHtml(c.un) : 'Despesas fixas'}</b><b data-o="dr-v" style="font-size:1.4rem;color:var(--accent)"></b></div>
    <button class="btn btn-primary" style="width:100%;margin-top:10px" data-act="fechar">Pronto</button></div>`;
  document.body.classList.add('pr-dr');
  atualizarPainel();
}
function atualizarPainel() {
  if (!DR) return;
  const c = S.cfg, v = $('pr-drawer').querySelector('[data-o="dr-v"]'), det = $('pr-drawer').querySelector('[data-o="dr-det"]');
  if (DR === 'fab') {
    const F = PR.fabrica(c);
    v.textContent = brl(F.v);
    det.innerHTML = `<div class="pr-tip">${brl(F.folha)} equipe + ${brl(F.en)} energia + ${brl(F.dep)} desgaste + ${brl(F.outros)} outros = <b>${brl(F.tot)}/mês</b> ÷ ${num(F.cap, 0)} ${escapeHtml(c.un)} = <b>${brl(F.calc)}</b></div>`;
  } else {
    const O = PR.overhead(c);
    v.textContent = pc(O.v);
    det.innerHTML = `<div class="pr-tip">${brl(O.f)} ÷ ${brl(O.fat)} = <b>${pc(O.calc)}</b> do faturamento</div>`;
  }
  atualizarEquivalencias();
}
function fecharPainel() { document.body.classList.remove('pr-dr'); DR = null; render(); }
const salvarConfig = () => salvarDepois('cfg', () => sb.from('pr_config').upsert({ subscriber_id: S.user.id, dados: S.cfg, updated_at: new Date().toISOString() }));

// Mostra "= 4.400,00" embaixo de campos onde a pessoa digitou uma conta.
function atualizarEquivalencias() {
  document.querySelectorAll('[data-eq]').forEach((el) => {
    const inp = el.previousElementSibling?.querySelector('input'); if (!inp) return;
    const v = PR.val(inp.value);
    el.textContent = Number.isNaN(v) ? 'valor inválido' : PR.temConta(inp.value) ? '= ' + num(v) : '';
    el.style.color = Number.isNaN(v) ? 'var(--red)' : '';
  });
}

// ─── RENDER E EVENTOS ────────────────────────────────────
function render() {
  document.querySelectorAll('#pr-nav button').forEach((b) => b.classList.toggle('active', b.dataset.aba === S.aba));
  const telas = { precificar: abaPrecificar, margens: abaMargens, receitas: abaReceitas, insumos: abaInsumos };
  $('pr-conteudo').innerHTML = (telas[S.aba] || abaPrecificar)();
  if (S.aba === 'precificar') atualizarPrecificar();
}

document.addEventListener('input', (e) => {
  const el = e.target, d = el.dataset;
  if (d.p !== undefined && el.tagName !== 'SELECT') { S.atual[d.p] = el.value; atualizarPrecificar(); return; }
  if (d.cfg !== undefined) { S.cfg[d.cfg] = el.value; salvarConfig(); atualizarPainel(); if (S.aba === 'precificar') atualizarPrecificar(); return; }
  if (d.busca) { S[d.busca === 'insumo' ? 'buscaInsumo' : 'buscaReceita'] = el.value; clearTimeout(timers.busca); timers.busca = setTimeout(() => { const pos = el.selectionStart; render(); const n = document.querySelector(`[data-busca="${d.busca}"]`); n?.focus(); n?.setSelectionRange(pos, pos); }, 250); return; }
  if (d.ins && el.tagName !== 'SELECT') {
    const i = S.insumos.find((x) => x.id === d.ins); if (!i) return;
    const numerico = ['conteudo', 'preco', 'aproveitamento'].includes(d.campo);
    const v = numerico ? PR.val(el.value) : el.value;
    if (numerico && !(Number.isFinite(v) && v > 0 || (d.campo === 'preco' && v === 0))) return;
    i[d.campo] = v;
    const cu = document.querySelector(`[data-o="cu-${i.id}"]`); if (cu) cu.textContent = custoLegivel(i);
    salvarDepois('ins-' + i.id, async () => {
      const r = await sb.from('pr_insumos').update({ [d.campo]: v }).eq('id', i.id);
      if (!r.error && (d.campo === 'preco' || d.campo === 'conteudo')) (S.historico[i.id] ||= []).push({ insumo_id: i.id, preco: i.preco, conteudo: i.conteudo, data: new Date().toISOString() });
      return r;
    }, 900);
    return;
  }
  if (d.receita && el.tagName !== 'SELECT') {
    const r = S.receitas.find((x) => x.id === S.receitaSel); if (!r) return;
    const v = d.receita === 'rendimento' ? PR.val(el.value) : el.value;
    if (d.receita === 'rendimento' && !(v > 0)) return;
    r[d.receita] = v; atualizarReceita();
    salvarDepois('rec-' + r.id, () => sb.from('pr_receitas').update({ [d.receita]: v, updated_at: new Date().toISOString() }).eq('id', r.id));
    return;
  }
  if (d.item && d.campo === 'quantidade') {
    const it = S.itens.find((x) => x.id === d.item); const v = PR.val(el.value); if (!it || !(v > 0)) return;
    it.quantidade = v; atualizarReceita();
    salvarDepois('item-' + it.id, () => sb.from('pr_receita_itens').update({ quantidade: v }).eq('id', it.id));
  }
});

document.addEventListener('change', async (e) => {
  const el = e.target, d = el.dataset;
  if (d.p !== undefined && el.tagName === 'SELECT') { S.atual[d.p] = el.value; render(); return; }
  if (d.cfgCb) { S.cfg[d.cfgCb] = el.checked; salvarConfig(); abrirPainel(DR); return; }
  if (d.ins && el.tagName === 'SELECT') {
    const i = S.insumos.find((x) => x.id === d.ins); i.unidade = el.value;
    const { error } = await sb.from('pr_insumos').update({ unidade: el.value }).eq('id', i.id);
    if (error) toast('Erro: ' + error.message, true); render(); return;
  }
  if (d.receita === 'unidade') {
    const r = S.receitas.find((x) => x.id === S.receitaSel); r.unidade = el.value;
    const { error } = await sb.from('pr_receitas').update({ unidade: el.value }).eq('id', r.id);
    if (error) toast('Erro: ' + error.message, true); render(); return;
  }
  if (d.item && d.campo === 'insumo_id' && el.value) {
    const it = S.itens.find((x) => x.id === d.item); it.insumo_id = el.value;
    const { error } = await sb.from('pr_receita_itens').update({ insumo_id: el.value }).eq('id', it.id);
    if (error) toast('Erro: ' + error.message, true); render(); return;
  }
  if (d.novoItem !== undefined && el.value) {
    const { data, error } = await sb.from('pr_receita_itens').insert({ subscriber_id: S.user.id, receita_id: S.receitaSel, insumo_id: el.value, quantidade: 1 }).select().single();
    if (error) { toast('Erro: ' + error.message, true); return; }
    S.itens.push(data); render();
    document.querySelector(`[data-item="${data.id}"][data-campo="quantidade"]`)?.select();
  }
  if (d.receita === 'nome') render();
});

document.addEventListener('focusin', (e) => { if (e.target.matches('.pr-box input, .pr-bigin input, .pr-table input.n')) setTimeout(() => e.target.select(), 0); });
document.addEventListener('keydown', (e) => {
  if (e.key === 'Escape' && DR) fecharPainel();
  if (e.key === 'Enter' && e.target.matches('input')) {
    const todos = [...document.querySelectorAll((DR ? '#pr-drawer ' : '#pr-conteudo ') + 'input:not([type=checkbox]), #pr-conteudo select')];
    const i = todos.indexOf(e.target); if (todos[i + 1]) todos[i + 1].focus(); else e.target.blur();
    e.preventDefault();
  }
});

document.addEventListener('click', async (e) => {
  const alvo = e.target.closest('[data-aba],[data-modo],[data-act],[data-abrir],[data-receita-sel],[data-del-produto],[data-del-insumo],[data-del-item]');
  if (!alvo) return;
  const d = alvo.dataset;
  if (d.aba) { S.aba = d.aba; render(); return; }
  if (d.modo) { S.modo = d.modo; render(); if (S.modo === 'test') document.querySelector('[data-p="preco"]')?.focus(); return; }
  if (d.delProduto) {
    e.stopPropagation();
    const x = S.produtos.find((p) => p.id === d.delProduto);
    if (!confirm(`Excluir o preço salvo de "${x.nome}"?`)) return;
    const { error } = await sb.from('pr_produtos').delete().eq('id', x.id);
    if (error) { toast('Erro: ' + error.message, true); return; }
    S.produtos = S.produtos.filter((p) => p.id !== x.id); if (S.atual.id === x.id) S.atual = PRODUTO_NOVO();
    render(); return;
  }
  if (d.abrir) { const x = S.produtos.find((p) => p.id === d.abrir); S.atual = { ...PRODUTO_NOVO(), ...x.dados, id: x.id, nome: x.nome }; S.modo = 'test'; S.aba = 'precificar'; render(); window.scrollTo({ top: 0, behavior: 'smooth' }); return; }
  if (d.receitaSel) { S.receitaSel = d.receitaSel; render(); return; }
  if (d.delInsumo) {
    const i = S.insumos.find((x) => x.id === d.delInsumo);
    if (S.itens.some((it) => it.insumo_id === i.id)) { toast(`"${i.nome}" é usado em receitas. Tire das receitas antes de excluir.`, true); return; }
    if (!confirm(`Excluir o insumo "${i.nome}" e o histórico de preços dele?`)) return;
    const { error } = await sb.from('pr_insumos').delete().eq('id', i.id);
    if (error) { toast('Erro: ' + error.message, true); return; }
    S.insumos = S.insumos.filter((x) => x.id !== i.id); render(); return;
  }
  if (d.delItem) {
    const { error } = await sb.from('pr_receita_itens').delete().eq('id', d.delItem);
    if (error) { toast('Erro: ' + error.message, true); return; }
    S.itens = S.itens.filter((x) => x.id !== d.delItem); render(); return;
  }
  switch (d.act) {
    case 'fab': case 'oh': abrirPainel(d.act); break;
    case 'fechar': fecharPainel(); break;
    case 'salvar-produto': await salvarProduto(); break;
    case 'novo-produto': S.atual = { ...PRODUTO_NOVO(), imp: S.atual.imp, fr: S.atual.fr, com: S.atual.com, lu: S.atual.lu }; S.modo = 'sug'; render(); $('pr-conteudo').querySelector('.pr-nome')?.focus(); break;
    case 'novo-insumo': {
      const { data, error } = await sb.from('pr_insumos').insert({ subscriber_id: S.user.id, nome: 'Novo insumo', unidade: 'g', conteudo: 1000, preco: 0 }).select().single();
      if (error) { toast('Erro: ' + error.message, true); break; }
      S.insumos.unshift(data); S.historico[data.id] = [{ insumo_id: data.id, preco: 0, conteudo: 1000, data: data.created_at }]; S.buscaInsumo = ''; render();
      document.querySelector(`[data-ins="${data.id}"][data-campo="nome"]`)?.select(); break;
    }
    case 'nova-receita': {
      const { data, error } = await sb.from('pr_receitas').insert({ subscriber_id: S.user.id, nome: 'Nova receita', rendimento: 1, unidade: S.cfg.un === 'kg' ? 'kg' : 'litro' }).select().single();
      if (error) { toast('Erro: ' + error.message, true); break; }
      S.receitas.push(data); S.receitaSel = data.id; S.buscaReceita = ''; render();
      document.querySelector('[data-receita="nome"]')?.select(); break;
    }
    case 'del-receita': {
      const r = S.receitas.find((x) => x.id === S.receitaSel);
      if (!confirm(`Excluir a receita "${r.nome}"? Preços salvos com ela passam a usar custo manual.`)) break;
      const { error } = await sb.from('pr_receitas').delete().eq('id', r.id);
      if (error) { toast('Erro: ' + error.message, true); break; }
      S.receitas = S.receitas.filter((x) => x.id !== r.id); S.itens = S.itens.filter((x) => x.receita_id !== r.id); S.receitaSel = null; render(); break;
    }
    case 'precificar-receita': S.atual = { ...PRODUTO_NOVO(), nome: S.receitas.find((x) => x.id === S.receitaSel).nome, receita_id: S.receitaSel }; S.modo = 'sug'; S.aba = 'precificar'; render(); break;
  }
});

// ─── INÍCIO ──────────────────────────────────────────────
function aviso(titulo, texto) {
  $('pr-aviso').innerHTML = `<h2>${titulo}</h2><p>${texto}</p><p style="margin-top:14px"><a class="pr-voltar" href="/app">← Voltar ao MeuArgus</a></p>`;
  $('pr-aviso').style.display = 'block';
}
(async function iniciar() {
  const { data: { session } } = await sb.auth.getSession();
  if (!session) { location.href = '/app'; return; }
  S.user = session.user;
  const [perfil, modulo] = await Promise.all([
    sb.from('subscribers').select('status,expira,is_admin').eq('id', S.user.id).single(),
    sb.from('modulos_assinante').select('precificacao').eq('subscriber_id', S.user.id).maybeSingle(),
  ]);
  const p = perfil.data;
  const hoje = new Date().toLocaleDateString('en-CA', { timeZone: 'America/Sao_Paulo' });
  const ativa = p && (p.is_admin || p.status === 'ativo' || (p.status === 'trial' && p.expira >= hoje));
  if (!ativa) { aviso('Assinatura inativa', 'Reative sua assinatura no MeuArgus para usar a Precificação. Seus dados continuam guardados.'); return; }
  if (!p.is_admin && !modulo.data?.precificacao) { aviso('Precificação não liberada', 'Este módulo ainda não está liberado para a sua conta. Fale com o suporte do MeuArgus para ativar.'); return; }
  try { await carregarTudo(); } catch (err) { aviso('Não foi possível carregar', escapeHtml(err.message || String(err))); return; }
  $('pr-app').style.display = 'block';
  render();
})();
