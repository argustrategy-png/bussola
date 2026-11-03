// Aba Indicadores e posição de caixa (Caixas e Bancos).

// ─── INDICADORES ─────────────────────────────────────────
function calcIndicadores() {
  document.getElementById('p-selic').value = paramsState.selic || '';
  document.getElementById('p-cartao').value = paramsState.cartao || '';
  document.getElementById('p-margem').value = (paramsState.margem === null || paramsState.margem === undefined) ? '' : paramsState.margem;
  document.getElementById('p-meta-margem').value = paramsState.metaMargem;
  checkMargemAviso();
  document.getElementById('hero-meta-margem').textContent = paramsState.metaMargem + '%';

  const receitasPagas = data.filter(r => r.tipo === 'receber' && r.status === 'pago').reduce((s,r)=>s+valorConvertido(r),0);
  const ctvPago = data.filter(r => r.tipo === 'pagar' && r.status === 'pago' && r.toc === 'ctv').reduce((s,r)=>s+valorConvertido(r),0);
  const doPago = data.filter(r => r.tipo === 'pagar' && r.status === 'pago' && r.toc !== 'ctv').reduce((s,r)=>s+valorConvertido(r),0);
  const despesasTotais = ctvPago + doPago;
  const LL = receitasPagas - despesasTotais;
  const margem = receitasPagas > 0 ? (LL / receitasPagas * 100) : null;

  const t = today(), t30 = addDays(t, 30);
  // Card "Receita Recebida" mostra só os últimos 3 meses (não o acumulado
  // desde sempre, que é o que `receitasPagas` continua sendo — usado na
  // margem/lucro líquido, que não muda aqui) — pedido do usuário pra ter uma
  // leitura de curto prazo em vez do total histórico.
  const receita3Meses = data.filter(r => r.tipo === 'receber' && r.status === 'pago' && r.vencimento >= addDays(t, -90) && r.vencimento <= t).reduce((s,r)=>s+valorConvertido(r),0);
  let saldo = saldoRealCalculado;
  if (saldo === null) {
    saldo = 0;
    data.filter(r => r.status === 'pago').forEach(r => { saldo += r.tipo === 'receber' ? valorConvertido(r) : -valorConvertido(r); });
  }
  const recv30 = data.filter(r => r.tipo === 'receber' && r.status !== 'pago' && r.vencimento >= t && r.vencimento <= t30).reduce((s,r)=>s+valorConvertido(r),0);
  const pag30  = data.filter(r => r.tipo === 'pagar'  && r.status !== 'pago' && r.vencimento >= t && r.vencimento <= t30).reduce((s,r)=>s+valorConvertido(r),0);
  const liquidez = pag30 > 0 ? (saldo + recv30) / pag30 : null;
  const capGiro = Math.max(0, pag30 - recv30 - saldo);

  const despesaMedia = despesasTotais / mesesDistintosPagos();
  const folego = despesaMedia > 0 ? saldo / despesaMedia : null;

  return { receitasPagas, receita3Meses, ctvPago, doPago, despesasTotais, LL, margem, saldo, recv30, pag30, liquidez, capGiro, folego };
}

// ── Posição de caixa (Caixas e Bancos) ──────────────────────────────────
// Cotação do dia via Banco Central (PTAX/Olinda), cacheada por moeda+dia —
// usada tanto na posição de caixa quanto na conversão dos lançamentos
// (valorConvertido, acima).
async function buscarCotacaoBacen(moeda) {
  if (moeda === 'BRL') return { moeda: 'BRL', data: today(), taxa: 1, boletim: null };
  const hoje = new Date();
  for (let voltar = 0; voltar <= 8; voltar++) {
    const d = new Date(hoje); d.setDate(d.getDate() - voltar);
    const chaveISO = d.toISOString().split('T')[0];
    const chaveCache = `meuargus_cambio_${moeda}_${chaveISO}`;
    const cacheado = localStorage.getItem(chaveCache);
    if (cacheado) { try { return JSON.parse(cacheado); } catch { /* ignora cache corrompido */ } }
    const mmddyyyy = `${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}-${d.getFullYear()}`;
    const url = `https://olinda.bcb.gov.br/olinda/servico/PTAX/versao/v1/odata/CotacaoMoedaDia(moeda=@moeda,dataCotacao=@dataCotacao)?@moeda='${moeda}'&@dataCotacao='${mmddyyyy}'&$format=json`;
    try {
      const resp = await fetch(url);
      if (!resp.ok) continue;
      const json = await resp.json();
      const ultimo = (json.value || []).slice(-1)[0];
      if (!ultimo) continue; // sem boletim nesse dia (fim de semana/feriado) — tenta o dia anterior
      const resultado = { moeda, data: chaveISO, taxa: (ultimo.cotacaoCompra + ultimo.cotacaoVenda) / 2, boletim: ultimo.tipoBoletim };
      localStorage.setItem(chaveCache, JSON.stringify(resultado));
      return resultado;
    } catch (e) { /* rede fora do ar — tenta o dia anterior */ }
  }
  return null;
}

// Câmbio de todas as moedas presentes nos lançamentos carregados — poucas
// distintas (BRL + as moedas Wise), então um Promise.all cobre tudo de uma
// vez em vez de buscar por lançamento.
async function atualizarCotacoesLancamentos() {
  const moedas = [...new Set(data.map(r => r.moeda || 'BRL'))];
  const mapa = { BRL: 1 };
  await Promise.all(moedas.filter(m => m !== 'BRL').map(async (m) => {
    const cot = await buscarCotacaoBacen(m);
    mapa[m] = cot ? cot.taxa : 1; // sem cotação disponível: melhor não converter que quebrar a conta
  }));
  cotacoesLancamentos = mapa;
}
// Valor de um lançamento em R$, convertendo pela moeda que veio do ERP
// (`r.moeda` — null/BRL não converte). Usar em todo lugar que soma
// `r.valor` de lançamentos pra não misturar USD/EUR como se fosse R$.
function valorConvertido(r) {
  return (r.valor || 0) * (cotacoesLancamentos[r.moeda || 'BRL'] || 1);
}

// Calculado automaticamente pelo backend a partir do histórico de Caixas e
// Bancos do Bling (ver sincronizarPosicaoCaixa em api/erp/sync.js) e
// guardado no Supabase — o frontend só lê e mostra, nunca digita nem edita.
async function renderSaldosMoeda() {
  const tb = document.getElementById('tb-saldos-moeda');
  if (!tb) return;
  const { data: lista, error } = await sb.from('saldos_caixas').select('*').not('conta_financeira_id', 'is', null).order('nome', { ascending: true });
  if (error) { tb.innerHTML = '<tr><td colspan="5" class="empty">Erro ao carregar.</td></tr>'; return; }
  if (!lista.length) {
    tb.innerHTML = '<tr><td colspan="5" class="empty">Ainda não sincronizado — clique em "Atualizar posição de caixa".</td></tr>';
    document.getElementById('saldo-moeda-total').textContent = fmt(0);
    return;
  }
  const moedasUnicas = [...new Set(lista.map(s => s.moeda))];
  const cotacoes = {};
  await Promise.all(moedasUnicas.map(async (m) => { cotacoes[m] = await buscarCotacaoBacen(m); }));

  let total = 0;
  tb.innerHTML = lista.map(s => {
    const cot = cotacoes[s.moeda];
    const valorR = cot ? s.valor * cot.taxa : null;
    if (valorR !== null) total += valorR;
    const cambioTxt = s.moeda === 'BRL' ? '—' : (cot ? `1 ${s.moeda} = ${cot.taxa.toLocaleString('pt-BR',{minimumFractionDigits:4,maximumFractionDigits:4})} (${fmtDate(cot.data)})` : 'cotação indisponível');
    return `<tr>
      <td>${escapeHtml(s.nome || '—')}</td>
      <td>${s.moeda}</td>
      <td>${s.valor.toLocaleString('pt-BR',{minimumFractionDigits:2,maximumFractionDigits:2})}</td>
      <td>${cambioTxt}</td>
      <td>${valorR !== null ? fmt(valorR) : '—'}</td>
    </tr>`;
  }).join('');
  document.getElementById('saldo-moeda-total').textContent = fmt(total);
}

// Recalcula saldoRealCalculado a partir da posição de caixa (ver acima) e
// refaz o Painel com o número certo — chamada no carregamento inicial e
// depois de cada sincronização, já que ela roda em paralelo com o resto do
// carregamento (não trava a tela esperando a cotação do Banco Central).
async function atualizarSaldoRealCalculado() {
  const { data: lista, error } = await sb.from('saldos_caixas').select('valor,moeda').not('conta_financeira_id', 'is', null);
  if (error || !lista || !lista.length) { saldoRealCalculado = null; return; }
  const moedasUnicas = [...new Set(lista.map(s => s.moeda))];
  const cotacoes = {};
  await Promise.all(moedasUnicas.map(async (m) => { cotacoes[m] = await buscarCotacaoBacen(m); }));
  let total = 0;
  for (const s of lista) {
    const cot = cotacoes[s.moeda];
    if (cot) total += Number(s.valor) * cot.taxa;
  }
  saldoRealCalculado = total;
  renderDashboard();
}

// Uma chamada ao backend só pagina um pedaço do histórico do Bling (teto de
// tempo de uma function da Vercel) — se ainda não terminou, chama de novo
// automaticamente até concluir, em vez de fazer a pessoa clicar várias
// vezes. MAX_TENTATIVAS é só uma trava de segurança (cada chamada cobre uns
// 55s de paginação no backend, então 40 tentativas já é bem mais histórico
// do que qualquer conta deveria ter).
async function atualizarPosicaoCaixa() {
  const btn = document.getElementById('btn-atualizar-posicao');
  const status = document.getElementById('posicao-caixa-status');
  if (!erpStatusAtual.bling) { status.textContent = 'Disponível só para quem usa Bling.'; return; }
  const MAX_TENTATIVAS = 40;
  btn.disabled = true;
  try {
    for (let tentativa = 1; tentativa <= MAX_TENTATIVAS; tentativa++) {
      status.textContent = tentativa === 1 ? 'Sincronizando posição de caixa…' : `Sincronizando posição de caixa… (parte ${tentativa})`;
      const resp = await fetch('/api/erp/sync', { method: 'POST', headers: await erpAuthHeader(), body: JSON.stringify({ provider: 'bling', tipo: 'posicao_caixa' }) });
      const data = await resp.json();
      if (!resp.ok || !data.ok) { status.textContent = 'Erro ao sincronizar ✗'; return; }
      if (data.concluido) break;
    }
    // Aproveita as contas financeiras já resolvidas acima pra também
    // descobrir a moeda dos lançamentos (contas a pagar/receber) — mesmo
    // fluxo, roda em seguida porque um depende do outro (moeda_lancamentos
    // usa o mapa conta_financeira → moeda que a posição de caixa acabou de
    // gravar em saldos_caixas).
    for (let tentativa = 1; tentativa <= MAX_TENTATIVAS; tentativa++) {
      status.textContent = tentativa === 1 ? 'Resolvendo moeda dos lançamentos…' : `Resolvendo moeda dos lançamentos… (parte ${tentativa})`;
      const resp = await fetch('/api/erp/sync', { method: 'POST', headers: await erpAuthHeader(), body: JSON.stringify({ provider: 'bling', tipo: 'moeda_lancamentos' }) });
      const data = await resp.json();
      if (!resp.ok || !data.ok) { status.textContent = 'Erro ao resolver moeda dos lançamentos ✗'; return; }
      if (data.concluido) break;
    }
    await loadData(); // recarrega lançamentos (moeda atualizada) e recalcula tudo
    status.textContent = 'Atualizado ✓';
  } catch (e) {
    status.textContent = 'Erro ao sincronizar ✗';
  } finally {
    btn.disabled = false;
  }
}

function renderIndicadores() {
  const k = calcIndicadores();

  document.getElementById('k-receita').textContent = fmt(k.receita3Meses);
  document.getElementById('k-capgiro').textContent = fmt(k.capGiro);
  renderSaldosMoeda();

  const folegoEl = document.getElementById('k-folego');
  const folegoCard = document.getElementById('k-card-folego');
  if (k.folego === null) { folegoEl.textContent = '—'; folegoCard.className = 'card'; }
  else {
    folegoEl.textContent = k.folego.toFixed(1) + ' meses';
    folegoCard.className = 'card ' + (k.folego >= 6 ? 'green' : k.folego >= 3 ? 'amber' : 'red');
  }
}
