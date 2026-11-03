// Insights (agentes especialistas) da aba Indicadores.

// ─── INSIGHTS (agentes especialistas) ───────────────────
function renderInsights() {
  const k = calcIndicadores();
  const box = document.getElementById('agents-box');
  const cards = [];

  // Agente de Rentabilidade
  if (k.margem === null) {
    cards.push({ icon:'💰', nome:'Agente de Rentabilidade', cls:'warn', msg:'Ainda não há receita recebida suficiente para calcular a margem líquida. Registre e marque como pagos os lançamentos de receita.' });
  } else if (k.margem < 0) {
    cards.push({ icon:'💰', nome:'Agente de Rentabilidade', cls:'bad', msg:`Margem líquida negativa (${k.margem.toFixed(1)}%): as despesas pagas superam a receita recebida. Antes de qualquer outra decisão, é preciso reverter esse quadro — corte custos variáveis ou renegocie despesas fixas.` });
  } else if (k.margem < paramsState.metaMargem) {
    cards.push({ icon:'💰', nome:'Agente de Rentabilidade', cls:'warn', msg:`Margem líquida de ${k.margem.toFixed(1)}%, abaixo da meta mínima de ${paramsState.metaMargem}% definida para o negócio. Faltam ${(paramsState.metaMargem-k.margem).toFixed(1)} pontos percentuais — avalie preço, mix de produtos ou custo variável (hoje ${fmt(k.ctvPago)}).` });
  } else {
    cards.push({ icon:'💰', nome:'Agente de Rentabilidade', cls:'ok', msg:`Margem líquida de ${k.margem.toFixed(1)}%, acima da meta mínima de ${paramsState.metaMargem}%. O negócio está gerando valor de forma saudável — foco agora em manter a disciplina de custos enquanto cresce.` });
  }

  // Agente de Caixa
  if (k.liquidez !== null && k.liquidez < 1) {
    cards.push({ icon:'🏦', nome:'Agente de Caixa', cls:'bad', msg:`Índice de liquidez de ${k.liquidez.toFixed(2)}x: o saldo atual mais o que entra em 30 dias não cobre o que precisa ser pago no período. Negocie prazos com fornecedores ou antecipe recebíveis.` });
  } else if (k.folego !== null && k.folego < 3) {
    cards.push({ icon:'🏦', nome:'Agente de Caixa', cls:'warn', msg:`O caixa atual sustenta a operação por cerca de ${k.folego.toFixed(1)} meses no ritmo atual de despesas. Menos de 3 meses de fôlego é um sinal de alerta — vale reforçar o colchão de caixa.` });
  } else {
    cards.push({ icon:'🏦', nome:'Agente de Caixa', cls:'ok', msg: k.folego !== null ? `Fôlego de caixa de ${k.folego.toFixed(1)} meses e liquidez saudável. A operação tem margem de manobra para imprevistos de curto prazo.` : 'Sem despesas pagas registradas ainda para estimar o fôlego de caixa — continue lançando os pagamentos conforme eles acontecem.' });
  }

  // Agente de Custo de Capital
  const selic = paramsState.selic || 0;
  const cartaoAnual = (paramsState.cartao || 0) * 12;
  if (paramsState.cartao > 0 && selic > 0) {
    const diferenca = cartaoAnual - selic;
    if (diferenca > 0) {
      cards.push({ icon:'💳', nome:'Agente de Custo de Capital', cls:'warn', msg:`A taxa de cartão informada (${paramsState.cartao.toFixed(2)}% a.m., ≈ ${cartaoAnual.toFixed(1)}% a.a.) é ${diferenca.toFixed(1)} pontos percentuais mais cara que a Selic (${selic.toFixed(2)}% a.a.). Antes de antecipar recebíveis pelo cartão, compare com uma linha de crédito bancária referenciada na Selic — pode sair mais barato.` });
    } else {
      cards.push({ icon:'💳', nome:'Agente de Custo de Capital', cls:'ok', msg:`A taxa de cartão informada (≈ ${cartaoAnual.toFixed(1)}% a.a.) está próxima ou abaixo da Selic (${selic.toFixed(2)}% a.a.) — antecipar recebíveis pelo cartão não parece estar mais caro do que outras fontes de crédito.` });
    }
  } else {
    cards.push({ icon:'💳', nome:'Agente de Custo de Capital', cls:'info', msg:'Informe a Selic e a taxa de cartão nos Parâmetros de Referência (aba Indicadores) para comparar o custo de antecipar recebíveis com outras fontes de crédito.' });
  }
  if (paramsState.cartao > 0) {
    cards.push({ icon:'📊', nome:'Agente de Custo de Capital', cls:'info', msg:`Ao aceitar antecipação de recebíveis via cartão, compare o custo (${paramsState.cartao.toFixed(2)}% a.m.) com sua margem líquida (${k.margem !== null ? k.margem.toFixed(1)+'%' : '—'}) antes de repassar ao cliente ou absorver a taxa.` });
  }

  box.innerHTML = cards.map(c => `
    <div class="agent-card ${c.cls}">
      <div class="agent-icon">${c.icon}</div>
      <div><div class="agent-name">${c.nome}</div><div class="agent-msg">${c.msg}</div></div>
    </div>`).join('');

  // Classification table
  const pagarItems = data.filter(r => r.tipo === 'pagar');
  const tb = document.getElementById('tb-class');
  if (pagarItems.length === 0) {
    tb.innerHTML = `<tr><td colspan="5" class="empty">Nenhuma conta a pagar registrada.</td></tr>`;
    return;
  }
  tb.innerHTML = pagarItems.map(r => `
    <tr>
      <td>${escapeHtml(r.descricao)}</td>
      <td><span class="badge pagar">A Pagar</span></td>
      <td>${fmt(r.valor)}</td>
      <td>${r.status === 'pago' ? '✅ Pago' : '⏳ Pendente'}</td>
      <td>
        <select onchange="setToc('${r.id}', this.value)" style="padding:5px 8px;border:1px solid var(--border);border-radius:6px;font-size:0.82rem;background:var(--surface);color:var(--text);font-family:Inter,sans-serif">
          <option value="do" ${r.toc !== 'ctv' ? 'selected' : ''}>Fixo</option>
          <option value="ctv" ${r.toc === 'ctv' ? 'selected' : ''}>Variável</option>
        </select>
      </td>
    </tr>`).join('');
}

async function setToc(id, val) {
  const r = data.find(r => r.id === id);
  if (!r) return;
  const ok = await _update(id, { toc: val });
  if (ok) { r.toc = val; renderInsights(); renderIndicadores(); }
}
