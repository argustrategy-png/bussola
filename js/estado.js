// Estado global do app (lançamentos, parâmetros, templates de cobrança).

// ─── STATE ───────────────────────────────────────────────
let data = [];
// Saldo real, calculado a partir da posição de caixa (soma de todas as
// contas de Caixas e Bancos do Bling, convertida pra R$) — substitui a soma
// ingênua de "tudo que já foi pago" (que não tem como bater com o saldo de
// verdade: mistura moeda estrangeira como se fosse R$ e nunca teve um saldo
// inicial). null enquanto não há posição de caixa calculada pra essa conta
// (ex.: sem Bling conectado) — nesse caso os cálculos caem de volta pra soma
// antiga, melhor que nada.
let saldoRealCalculado = null;
// Câmbio do dia por moeda, pros lançamentos (contas a pagar/receber) que
// vieram do ERP em moeda estrangeira — cada um carrega sua própria `moeda`
// (resolvida no backend via a conta que liquidou o pagamento, ou via o
// "portador" dos ainda pendentes; ver sync.js). BRL sempre 1, o resto fica
// null até atualizarCotacoesLancamentos() rodar.
let cotacoesLancamentos = { BRL: 1 };
let paramsState = JSON.parse(localStorage.getItem('meuargus_params') || '{"selic":10.75,"cartao":3.5,"margem":null,"metaMargem":25}');
if (paramsState.metaMargem === undefined) paramsState.metaMargem = 25;
const TEMPLATES_PADRAO = {
  lembrete: 'Olá {cliente}! Passando para lembrar que sua fatura de {valor} vence em {vencimento}. Qualquer dúvida, estou à disposição!',
  vencimento: 'Olá {cliente}, sua fatura de {valor} vence hoje ({vencimento}). Para evitar juros, garanta o pagamento ainda hoje. Obrigado!',
  vencido: 'Olá {cliente}, identificamos que sua fatura de {valor}, vencida em {vencimento}, está em aberto há {dias_atraso} dia(s). Podemos ajudar a regularizar?'
};
let templatesState = Object.assign({}, TEMPLATES_PADRAO, JSON.parse(localStorage.getItem('meuargus_templates') || '{}'));

function saveTemplates() {
  templatesState.lembrete = document.getElementById('tpl-lembrete').value;
  templatesState.vencimento = document.getElementById('tpl-vencimento').value;
  templatesState.vencido = document.getElementById('tpl-vencido').value;
  localStorage.setItem('meuargus_templates', JSON.stringify(templatesState));
}

function fillTemplate(tpl, r, dias) {
  return tpl
    .replace(/{cliente}/g, r.contraparte || 'Cliente')
    .replace(/{valor}/g, fmt(r.valor))
    .replace(/{vencimento}/g, fmtDate(r.vencimento))
    .replace(/{dias_atraso}/g, Math.max(0, dias || 0));
}

function waLink(telefone, msg) {
  const digits = (telefone || '').replace(/\D/g, '');
  if (!digits) return null;
  const comPais = digits.length <= 11 ? '55' + digits : digits;
  return 'https://wa.me/' + comPais + '?text=' + encodeURIComponent(msg);
}

async function copiarMsg(msg) {
  try { await navigator.clipboard.writeText(msg); showSync('Mensagem copiada ✓'); }
  catch (e) { showSync('Não foi possível copiar ✗', true); }
}

function acaoCobranca(r, tplKey, dias) {
  const msg = fillTemplate(templatesState[tplKey], r, dias);
  const link = waLink(r.contraparte_telefone, msg);
  const escMsg = escapeHtml(msg);
  if (link) return `<a class="btn-whatsapp" href="${link}" target="_blank" rel="noopener">📲 WhatsApp</a>`;
  return `<button class="btn-copy" data-msg="${escMsg}" onclick="copiarMsg(this.dataset.msg)">Copiar msg</button>`;
}
let chartPrevisao;
let chartCaixa30;
let pendingImport = [];
let currentUser = null;
let perfilAssinante = null;
let authMode = 'login';
