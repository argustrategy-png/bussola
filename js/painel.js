// Aba Painel.

// ─── PAINEL ──────────────────────────────────────────────
function renderDashboard() {
  const t = today(), t30 = addDays(t, 30);
  let saldo = saldoRealCalculado, recv30 = 0, pag30 = 0;
  if (saldo === null) {
    saldo = 0;
    data.filter(r => r.status === 'pago').forEach(r => { saldo += r.tipo === 'receber' ? valorConvertido(r) : -valorConvertido(r); });
  }
  data.filter(r => r.status !== 'pago' && r.vencimento >= t && r.vencimento <= t30).forEach(r => {
    if (r.tipo === 'receber') recv30 += valorConvertido(r); else pag30 += valorConvertido(r);
  });
  const liq = recv30 - pag30;
  document.getElementById('c-saldo').textContent = fmt(saldo);
  document.getElementById('c-receber').textContent = fmt(recv30);
  document.getElementById('c-pagar').textContent = fmt(pag30);
  document.getElementById('c-liquido').textContent = fmtSgn(liq);
  const cl = document.getElementById('card-liquido');
  cl.className = 'card ' + (liq >= 0 ? 'green' : 'red');
  renderAgendaSemana();
  renderAtrasados();
  renderCaixaMinimo();
  renderGaugeCaixa();
  renderGaugeMeta();
  renderAlertas(saldo, recv30, pag30);
  document.getElementById('hd-subtitle').textContent = `${data.length} lançamentos · Saldo ${fmt(saldo)}`;
}

// Velocímetro de saúde do caixa: em vez de uma curva pra interpretar, uma
// leitura de relance — o ponteiro cai no vermelho quanto mais perto (ou já
// dentro) do caixa negativo, e no verde quanto mais fôlego sobra.
// Projeção diária do caixa: parte do saldo já realizado (pago) e soma, dia a dia,
// o que está pendente e vence naquele dia. Só entram lançamentos com vencimento
// de hoje em diante — o que já venceu e não foi baixado não entra na projeção.
function projetarCaixa(horizonte) {
  const t = today();
  let acum = saldoRealCalculado;
  if (acum === null) {
    acum = 0;
    data.filter(r => r.status === 'pago').forEach(r => { acum += r.tipo === 'receber' ? valorConvertido(r) : -valorConvertido(r); });
  }
  const saldoHoje = acum;
  const dias = [];
  for (let i = 0; i < horizonte; i++) {
    const d = addDays(t, i);
    data.filter(r => r.status !== 'pago' && r.vencimento === d).forEach(r => {
      acum += r.tipo === 'receber' ? valorConvertido(r) : -valorConvertido(r);
    });
    dias.push({ i, data: d, saldo: acum });
  }
  return { saldoHoje, dias };
}

function renderGaugeCaixa() {
  const t = today();
  const horizonte = 30;
  const { saldoHoje, dias } = projetarCaixa(horizonte);
  const negativo = dias.find(x => x.saldo < 0);
  const diaNegativo = negativo ? negativo.i : null;
  const saldoFinal = dias[dias.length - 1].saldo;

  // fração 0 = já negativo agora (ponteiro no fundo do vermelho)
  // fração 1 = fica positivo os 30 dias inteiros (ponteiro no fundo do verde)
  let fracao, titulo, sub, classe;
  if (saldoHoje < 0) {
    fracao = 0;
    titulo = '🚨 Caixa já está negativo';
    sub = `Saldo atual: ${fmtSgn(saldoHoje)}. Priorize receber o que está em atraso ou negocie prazos.`;
    classe = 'crit';
  } else if (diaNegativo !== null) {
    fracao = diaNegativo / horizonte;
    const dataCritica = fmtDate(addDays(t, diaNegativo));
    titulo = diaNegativo === 0 ? '🚨 Caixa fica negativo hoje' : `⚠️ Caixa fica negativo em ${diaNegativo} dia(s)`;
    sub = `Previsão pra ${dataCritica}. Dá pra antecipar recebíveis ou adiar algum pagamento antes disso.`;
    classe = diaNegativo <= 7 ? 'crit' : 'warn';
  } else {
    fracao = 1;
    titulo = '✅ Caixa saudável pelos próximos 30 dias';
    sub = `Saldo previsto no fim do período: ${fmtSgn(saldoFinal)}.`;
    classe = 'ok';
  }

  const arcoEl = document.getElementById('gauge-caixa-arc');
  const comprimento = arcoEl.getTotalLength();
  arcoEl.style.strokeDasharray = `${comprimento} ${comprimento}`;
  arcoEl.style.strokeDashoffset = `${comprimento * (1 - fracao)}`;
  arcoEl.setAttribute('class', classe);
  const tituloEl = document.getElementById('gauge-title');
  tituloEl.textContent = titulo;
  tituloEl.className = 'gauge-title ' + classe;
  document.getElementById('gauge-sub').textContent = sub;
}

// Velocímetro de meta de vendas: quanto falta faturar este mês (além do
// saldo em caixa e dos recebíveis já garantidos) pra cobrir as contas do
// mês, convertido de "caixa que falta" pra "venda necessária" usando a
// margem de contribuição real (receita paga - custo variável pago).
function fimMesAtual() {
  const now = new Date();
  return new Date(now.getFullYear(), now.getMonth() + 1, 0).toISOString().split('T')[0];
}

function renderGaugeMeta() {
  const t = today();
  const fimMes = fimMesAtual();
  const k = calcIndicadores();

  let contasMes = 0, recebiveisMes = 0;
  data.filter(r => r.tipo === 'pagar' && r.status !== 'pago' && r.vencimento <= fimMes).forEach(r => { contasMes += r.valor; });
  data.filter(r => r.tipo === 'receber' && r.status !== 'pago' && r.vencimento >= t && r.vencimento <= fimMes).forEach(r => { recebiveisMes += r.valor; });

  const caixaFaltante = Math.max(0, contasMes - recebiveisMes - k.saldo);
  const margemManual = (paramsState.margem !== null && paramsState.margem !== undefined && !isNaN(paramsState.margem)) ? paramsState.margem / 100 : null;
  // Só confia no cálculo automático se houver custo variável de fato
  // classificado (toc='ctv') em algum lançamento pago. Sem isso, ctvPago fica
  // sempre 0 — e isso não quer dizer "sem custo variável", quer dizer "ninguém
  // classificou ainda" (é o caso de todo lançamento vindo de ERP: os
  // conectores gravam 'do' por padrão, ver mapConta em api/_lib/providers/*).
  // Reportar 100% de margem nesse caso seria enganoso, então cai no mesmo
  // "sem dados" de quando não há receita paga.
  const margemCalculada = (k.receitasPagas > 0 && k.ctvPago > 0) ? (k.receitasPagas - k.ctvPago) / k.receitasPagas : null;
  const margemContrib = margemManual !== null ? margemManual : margemCalculada;
  const margemEhManual = margemManual !== null;

  let metaVendas = null;
  if (caixaFaltante > 0) {
    if (margemContrib === null) metaVendas = caixaFaltante;
    else if (margemContrib > 0) metaVendas = caixaFaltante / margemContrib;
  }

  const fracao = contasMes > 0 ? Math.min(1, Math.max(0, 1 - caixaFaltante / contasMes)) : 1;

  // Escala do arco: a ponta esquerda é o pior caso (precisar vender tudo,
  // nada coberto ainda) e a direita é R$0 (meta já batida) — só os dois
  // extremos ficam escritos, em vez de uma régua de números colada no traço.
  const metaMaxima = contasMes > 0 ? (margemContrib !== null && margemContrib > 0 ? contasMes / margemContrib : contasMes) : 0;
  document.getElementById('gm-tick-start').textContent = fmtCompact(metaMaxima);
  document.getElementById('gm-tick-end').textContent = fmtCompact(0);

  let titulo, sub, classe;

  if (caixaFaltante === 0) {
    titulo = '✅ Meta do mês já garantida';
    sub = `Saldo atual + recebíveis já cobrem as contas de ${fmt(contasMes)} deste mês.`;
    classe = 'ok';
  } else if (margemContrib !== null && margemContrib <= 0) {
    titulo = '⚠️ Margem de contribuição negativa';
    sub = margemEhManual
      ? `Faltam ${fmt(caixaFaltante)} em caixa pra cobrir as contas do mês, mas a margem de contribuição informada (${paramsState.margem}%) é zero ou negativa — revise o valor em Indicadores › Parâmetros de Referência.`
      : `Faltam ${fmt(caixaFaltante)} em caixa pra cobrir as contas do mês, mas os custos variáveis pagos superam a receita paga — reveja preço ou custo variável antes de definir uma meta de vendas.`;
    classe = 'crit';
  } else if (margemContrib === null) {
    titulo = `🎯 Meta de vendas: pelo menos ${fmt(metaVendas)}`;
    sub = k.receitasPagas > 0
      ? `Faltam ${fmt(caixaFaltante)} em caixa pra cobrir as contas do mês. Nenhuma conta a pagar está classificada como "Variável" ainda (lançamentos de ERP entram como "Fixo" por padrão), então não dá pra calcular a margem de contribuição automaticamente — essa meta é em valor bruto. Classifique alguns custos como Variável na aba Lançamentos, ou informe sua margem direto em Indicadores › Parâmetros de Referência.`
      : `Faltam ${fmt(caixaFaltante)} em caixa pra cobrir as contas do mês. Ainda não há receita paga suficiente pra calcular a margem de contribuição, então essa meta é em valor bruto, sem descontar custo variável. Se preferir, informe sua margem em Indicadores › Parâmetros de Referência.`;
    classe = fracao < 0.34 ? 'crit' : 'warn';
  } else {
    titulo = `🎯 Meta de vendas do mês: ${fmt(metaVendas)}`;
    sub = `Pra cobrir os ${fmt(caixaFaltante)} que faltam em caixa este mês, considerando ${margemEhManual ? 'a margem de contribuição que você informou' : 'sua margem de contribuição atual'} de ${(margemContrib * 100).toFixed(1)}%, você precisa faturar pelo menos esse valor.`;
    classe = fracao < 0.34 ? 'crit' : 'warn';
  }

  const arcoEl = document.getElementById('gauge-meta-arc');
  const comprimento = arcoEl.getTotalLength();
  arcoEl.style.strokeDasharray = `${comprimento} ${comprimento}`;
  arcoEl.style.strokeDashoffset = `${comprimento * (1 - fracao)}`;
  arcoEl.setAttribute('class', classe);
  const tituloEl = document.getElementById('gauge-meta-title');
  tituloEl.textContent = titulo;
  tituloEl.className = 'gauge-title ' + classe;
  document.getElementById('gauge-meta-sub').textContent = sub;
}

function ddmm(d) { const [, m, dd] = d.split('-'); return `${dd}/${m}`; }

// Tudo que vence hoje e nos próximos 7 dias (a pagar e a receber), pra "o que
// eu preciso fazer essa semana" sem precisar abrir a aba de Lançamentos.
function renderAgendaSemana() {
  const box = document.getElementById('agenda-box');
  const t = today(), t7 = addDays(t, 7);
  const itens = data
    .filter(r => r.status !== 'pago' && r.vencimento && r.vencimento >= t && r.vencimento <= t7)
    .sort((a, b) => a.vencimento.localeCompare(b.vencimento) || (a.tipo === 'pagar' ? -1 : 1));
  if (!itens.length) { box.innerHTML = '<div class="ag-vazio">Nada vence nos próximos 7 dias.</div>'; return; }
  const linha = r => {
    const quando = r.vencimento === t ? 'Hoje' : r.vencimento === addDays(t, 1) ? 'Amanhã' : ddmm(r.vencimento);
    const cor = r.tipo === 'receber' ? 'pos' : 'neg';
    const sinal = r.tipo === 'receber' ? '+' : '−';
    return `<div class="ag-item">
      <span class="ag-quando${quando === 'Hoje' ? ' hoje' : ''}">${quando}</span>
      <span class="ag-desc"><span class="ag-tit">${escapeHtml(r.descricao || '—')}</span><small>${r.tipo === 'receber' ? 'A receber' : 'A pagar'}${r.contraparte ? ' · ' + escapeHtml(r.contraparte) : ''}</small></span>
      <span class="ag-valor ${cor}">${sinal} ${fmt(r.valor)}</span>
    </div>`;
  };
  const MAX = 8;
  const totalRec = itens.filter(r => r.tipo === 'receber').reduce((s, r) => s + r.valor, 0);
  const totalPag = itens.filter(r => r.tipo === 'pagar').reduce((s, r) => s + r.valor, 0);
  box.innerHTML =
    `<div class="ag-resumo"><span>Receber <strong style="color:var(--green)">${fmt(totalRec)}</strong></span><span>Pagar <strong style="color:var(--red)">${fmt(totalPag)}</strong></span></div>` +
    itens.slice(0, MAX).map(linha).join('') +
    (itens.length > MAX ? `<button class="ag-link" onclick="showTab('lancamentos')">+ ${itens.length - MAX} lançamento(s) — ver todos</button>` : '');
}

// Contas a receber vencidas e não baixadas, agrupadas por cliente: quem mais
// deve e há quanto tempo, com atalho pra régua de cobrança.
function renderAtrasados() {
  const box = document.getElementById('atrasados-box');
  const t = today();
  const vencidos = data.filter(r => r.tipo === 'receber' && r.status !== 'pago' && r.vencimento && r.vencimento < t);
  if (!vencidos.length) { box.innerHTML = '<div class="ag-vazio">🎉 Nenhum recebimento em atraso.</div>'; return; }
  const dias = v => Math.round((new Date(t + 'T12:00:00') - new Date(v + 'T12:00:00')) / 86400000);
  const porCliente = {};
  vencidos.forEach(r => {
    const nome = r.contraparte || r.descricao || 'Sem cliente informado';
    if (!porCliente[nome]) porCliente[nome] = { nome, total: 0, maiorAtraso: 0 };
    porCliente[nome].total += r.valor;
    porCliente[nome].maiorAtraso = Math.max(porCliente[nome].maiorAtraso, dias(r.vencimento));
  });
  const ranking = Object.values(porCliente).sort((a, b) => b.total - a.total);
  const total = vencidos.reduce((s, r) => s + r.valor, 0);
  box.innerHTML =
    `<div class="ag-resumo"><strong>${fmt(total)}</strong> em atraso · ${vencidos.length} lançamento(s) de ${ranking.length} cliente(s)</div>` +
    ranking.slice(0, 3).map(c => `<div class="ag-item">
      <span class="ag-desc"><span class="ag-tit">${escapeHtml(c.nome)}</span><small>${c.maiorAtraso} dia(s) de atraso</small></span>
      <span class="ag-valor neg">${fmt(c.total)}</span>
    </div>`).join('') +
    `<button class="ag-link" onclick="showTab('cobranca')">Abrir régua de cobrança</button>`;
}

// Menor saldo previsto nos próximos 30 dias e quando acontece: o saldo do fim
// do período esconde um aperto no meio do mês, e é isso que costuma quebrar o caixa.
function renderCaixaMinimo() {
  const horizonte = 30;
  const { saldoHoje, dias } = projetarCaixa(horizonte);
  let min = dias[0];
  dias.forEach(x => { if (x.saldo < min.saldo) min = x; });
  const tituloEl = document.getElementById('caixa-min-titulo');
  const subEl = document.getElementById('caixa-min-sub');
  const quando = min.i === 0 ? 'hoje' : `em ${ddmm(min.data)} (${min.i} dia${min.i > 1 ? 's' : ''})`;
  const classe = min.saldo < 0 ? 'crit' : (min.saldo < Math.max(0, saldoHoje) * 0.25 ? 'warn' : 'ok');
  tituloEl.className = 'caixa-min ' + classe;
  tituloEl.textContent = `Menor saldo previsto: ${fmtSgn(min.saldo)} ${quando}`;
  subEl.textContent = `Saldo hoje: ${fmtSgn(saldoHoje)}. Considera o que vence de hoje em diante; contas já vencidas e não baixadas não entram.`;

  if (chartCaixa30) chartCaixa30.destroy();
  const isDark = document.documentElement.getAttribute('data-theme') === 'dark';
  const tickColor = isDark ? '#7B9DC0' : '#64748B';
  const gridColor = isDark ? '#1E2F45' : '#E2E8F0';
  chartCaixa30 = new Chart(document.getElementById('chartCaixa30'), {
    type: 'line',
    data: {
      labels: dias.map(x => ddmm(x.data)),
      datasets: [{
        label: 'Saldo previsto', data: dias.map(x => x.saldo), borderColor: '#2563EB', borderWidth: 2,
        backgroundColor: 'rgba(37,99,235,0.10)', fill: true, tension: 0.2, pointRadius: dias.map(x => x.i === min.i ? 5 : 0),
        pointBackgroundColor: dias.map(x => x.i === min.i ? (min.saldo < 0 ? '#DC2626' : '#2563EB') : '#2563EB'),
      }],
    },
    options: {
      responsive: true, maintainAspectRatio: false,
      plugins: { legend: { display: false }, tooltip: { callbacks: { label: ctx => 'Saldo: ' + fmtSgn(ctx.raw) } } },
      scales: {
        y: { ticks: { callback: v => (v < 0 ? '-' : '') + fmtCompact(Math.abs(v)), color: tickColor }, grid: { color: ctx => ctx.tick.value === 0 ? '#DC2626' : gridColor } },
        x: { ticks: { color: tickColor, maxTicksLimit: 8 }, grid: { color: gridColor } },
      },
    },
  });
}

function renderAlertas(saldo, recv30, pag30) {
  const box = document.getElementById('insights-box');
  const t = today();
  const insights = [];
  const vencidos = data.filter(r => r.status !== 'pago' && r.vencimento < t);
  const totalVP = vencidos.filter(r => r.tipo === 'pagar').reduce((s,r)=>s+r.valor,0);
  const totalVR = vencidos.filter(r => r.tipo === 'receber').reduce((s,r)=>s+r.valor,0);
  if (totalVP > 0) insights.push({cls:'bad',title:'⚠️ Contas a pagar vencidas',body:`${fmt(totalVP)} em ${vencidos.filter(r=>r.tipo==='pagar').length} lançamento(s) vencido(s).`});
  if (totalVR > 0) insights.push({cls:'warn',title:'🔔 Recebimentos em atraso',body:`${fmt(totalVR)} em ${vencidos.filter(r=>r.tipo==='receber').length} lançamento(s) não recebido(s).`});
  const liq = recv30 - pag30;
  if (liq < 0) insights.push({cls:'bad',title:'📉 Fluxo negativo nos próximos 30 dias',body:`Saídas superam entradas em ${fmt(Math.abs(liq))}. Considere antecipar recebíveis ou postergar pagamentos.`});
  else if (liq > 0) insights.push({cls:'ok',title:'✅ Fluxo positivo nos próximos 30 dias',body:`Saldo previsto de +${fmt(liq)}. Boa saúde financeira no curto prazo.`});
  if (saldo + recv30 - pag30 < 0) insights.push({cls:'bad',title:'🚨 Caixa insuficiente previsto',body:`Com saldo atual + entradas − saídas, o caixa fica negativo em ${fmt(Math.abs(saldo+recv30-pag30))}.`});
  if (insights.length === 0) insights.push({cls:'ok',title:'👍 Nenhum alerta no momento',body:'Adicione lançamentos para obter alertas.'});
  box.innerHTML = insights.map(i=>`<div class="insight ${i.cls}"><strong>${i.title}</strong>${i.body}</div>`).join('');
}
