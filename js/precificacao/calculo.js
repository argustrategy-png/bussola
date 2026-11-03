// Cálculos da Precificação — sem DOM e sem Supabase, para poder testar no Node
// (ver scripts de teste). Tudo em R$; percentuais em pontos (9 = 9%).

const PR = (() => {
  // Aceita número brasileiro e contas simples: "4.100 + 3.400", "200*22", "2.198,49".
  function val(raw) {
    let s = String(raw ?? '').trim().replace(/R\$|%|\s/g, '');
    if (!s) return 0;
    if (s.includes(',')) s = s.replace(/\./g, '').replace(/,/g, '.');
    else s = s.replace(/\.(?=\d{3}(?!\d))/g, '');
    if (!/^[\d+\-*/().]+$/.test(s)) return NaN;
    try { const v = Function('"use strict";return(' + s + ')')(); return Number.isFinite(v) ? v : NaN; } catch { return NaN; }
  }
  const temConta = (raw) => /[+\-*/]/.test(String(raw ?? '').replace(/^-/, ''));

  // Custo por unidade de uso (g, ml, un), já descontando a perda.
  function custoUnitarioInsumo(i) {
    const util = Number(i.conteudo) * (Number(i.aproveitamento ?? 100) / 100);
    return util > 0 ? Number(i.preco) / util : NaN;
  }

  // itens: [{ insumo_id, quantidade }], insumos: Map id → insumo
  function custoReceita(receita, itens, insumos) {
    let total = 0, faltando = 0;
    const linhas = itens.map((it) => {
      const ins = insumos.get(it.insumo_id);
      const custo = ins ? custoUnitarioInsumo(ins) * Number(it.quantidade) : NaN;
      if (Number.isFinite(custo)) total += custo; else faltando++;
      return { ...it, insumo: ins, custo };
    });
    const rend = Number(receita.rendimento);
    return { linhas, total, porUnidade: rend > 0 ? total / rend : NaN, faltando };
  }

  // Custo de fábrica (ou da hora, em serviço) por unidade.
  function fabrica(c) {
    const folha = val(c.folha) * (1 + val(c.enc) / 100);
    const en = val(c.energia);
    const dep = val(c.vida) > 0 ? val(c.equip) / (val(c.vida) * 12) : 0;
    const outros = val(c.outros);
    const tot = folha + en + dep + outros, cap = val(c.cap);
    const calc = cap > 0 ? tot / cap : NaN;
    return { folha, en, dep, outros, tot, cap, calc, v: c.manual ? val(c.manualV) : calc };
  }

  function overhead(c) {
    const f = val(c.fixas), fat = val(c.fat);
    const calc = fat > 0 ? (f / fat) * 100 : NaN;
    return { f, fat, calc, v: c.ohManual ? val(c.ohV) : calc };
  }

  // p: { mp, emb, qtd, imp, fr, com, lu, preco } (mp já em R$ pela embalagem)
  function preco(p, cfg) {
    const F = fabrica(cfg), O = overhead(cfg);
    const mp = Number(p.mp) || 0, emb = val(p.emb), qtd = val(p.qtd);
    const tr = qtd * (Number.isFinite(F.v) ? F.v : 0);
    const custo = mp + emb + tr;
    const imp = val(p.imp), fr = val(p.fr), com = val(p.com), oh = Number.isFinite(O.v) ? O.v : 0, lu = val(p.lu);
    const desp = imp + fr + com + oh, soma = desp + lu;
    const sugerido = soma < 100 ? custo / (1 - soma / 100) : NaN;
    const pr = val(p.preco);
    const margemNoPreco = (P) => (P > 0 ? 100 - desp - (custo / P) * 100 : NaN);
    return { F, O, mp, emb, qtd, tr, custo, imp, fr, com, oh, lu, desp, soma, sugerido,
      mk: soma < 100 ? 100 / (100 - soma) : NaN, pr, margemReal: margemNoPreco(pr), margemNoPreco };
  }

  // Variação do preço de um insumo: atual vs. o registro mais antigo dentro da janela.
  function variacao(historico, dias = 90, agora = Date.now()) {
    if (!historico?.length) return NaN;
    const ord = [...historico].sort((a, b) => new Date(a.data) - new Date(b.data));
    const limite = agora - dias * 864e5;
    const base = ord.filter((h) => new Date(h.data) <= limite).pop() || ord[0];
    const atual = ord[ord.length - 1];
    const cu = (h) => Number(h.preco) / Number(h.conteudo);
    return base === atual ? 0 : (cu(atual) / cu(base) - 1) * 100;
  }

  return { val, temConta, custoUnitarioInsumo, custoReceita, fabrica, overhead, preco, variacao };
})();

if (typeof module !== 'undefined') module.exports = PR;
