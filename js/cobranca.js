// Aba Cobrança (régua de cobrança).

// ─── COBRANÇA (régua de cobrança) ───────────────────────
function diasAtraso(vencimento) {
  const hoje = new Date(today() + 'T12:00:00');
  const venc = new Date(vencimento + 'T12:00:00');
  return Math.round((hoje - venc) / 86400000);
}

function renderCobranca() {
  document.getElementById('tpl-lembrete').value = templatesState.lembrete;
  document.getElementById('tpl-vencimento').value = templatesState.vencimento;
  document.getElementById('tpl-vencido').value = templatesState.vencido;

  const aVencer = data.filter(r => r.tipo === 'receber' && r.status !== 'pago' && diasAtraso(r.vencimento) <= 0 && diasAtraso(r.vencimento) >= -3)
    .map(r => ({ ...r, dias: diasAtraso(r.vencimento) }))
    .sort((a,b) => b.dias - a.dias);
  const tbA = document.getElementById('tb-avencer');
  if (aVencer.length === 0) {
    tbA.innerHTML = `<tr><td colspan="5" class="empty">Nada vencendo nos próximos 3 dias.</td></tr>`;
  } else {
    tbA.innerHTML = aVencer.map(r => `
      <tr>
        <td>${escapeHtml(r.contraparte || '—')}</td>
        <td>${escapeHtml(r.descricao)}</td>
        <td>${r.dias === 0 ? '<strong>Hoje</strong>' : fmtDate(r.vencimento)}</td>
        <td>${fmt(r.valor)}</td>
        <td>${acaoCobranca(r, r.dias === 0 ? 'vencimento' : 'lembrete', r.dias)}</td>
      </tr>`).join('');
  }

  const vencidos = data.filter(r => r.tipo === 'receber' && r.status !== 'pago' && diasAtraso(r.vencimento) > 0)
    .map(r => ({ ...r, dias: diasAtraso(r.vencimento) }))
    .sort((a,b) => b.dias - a.dias);

  const faixas = [
    { label: '1 a 15 dias',  min: 1,  max: 15 },
    { label: '16 a 30 dias', min: 16, max: 30 },
    { label: '31 a 60 dias', min: 31, max: 60 },
    { label: 'Mais de 60 dias', min: 61, max: Infinity },
  ];
  const cardsHtml = faixas.map(f => {
    const itens = vencidos.filter(r => r.dias >= f.min && r.dias <= f.max);
    const total = itens.reduce((s,r)=>s+r.valor,0);
    const cls = f.min >= 61 ? 'red' : f.min >= 31 ? 'red' : f.min >= 16 ? 'amber' : 'amber';
    return `<div class="card ${itens.length ? cls : ''}"><label>${f.label}</label><div class="val">${fmt(total)}</div><div class="sub">${itens.length} lançamento(s)</div></div>`;
  }).join('');
  document.getElementById('aging-cards').innerHTML = cardsHtml;

  const tbV = document.getElementById('tb-vencidos');
  if (vencidos.length === 0) {
    tbV.innerHTML = `<tr><td colspan="6" class="empty">Nenhuma conta a receber vencida. 🎉</td></tr>`;
  } else {
    tbV.innerHTML = vencidos.map(r => `
      <tr>
        <td>${escapeHtml(r.contraparte || '—')}</td>
        <td>${escapeHtml(r.descricao)}</td>
        <td style="color:var(--red);font-weight:600">${fmtDate(r.vencimento)}</td>
        <td style="color:var(--red);font-weight:600">${r.dias} dia(s)</td>
        <td>${fmt(r.valor)}</td>
        <td>${acaoCobranca(r, 'vencido', r.dias)}</td>
      </tr>`).join('');
  }

  // Classificação de pagadores
  const porCliente = {};
  data.filter(r => r.tipo === 'receber' && r.contraparte).forEach(r => {
    const c = r.contraparte;
    if (!porCliente[c]) porCliente[c] = { recebido: 0, aberto: 0, maiorAtraso: 0 };
    if (r.status === 'pago') porCliente[c].recebido += r.valor;
    else {
      porCliente[c].aberto += r.valor;
      const d = diasAtraso(r.vencimento);
      if (d > porCliente[c].maiorAtraso) porCliente[c].maiorAtraso = d;
    }
  });
  const clientes = Object.entries(porCliente).sort((a,b) => b[1].maiorAtraso - a[1].maiorAtraso);
  const tbP = document.getElementById('tb-pagadores');
  if (clientes.length === 0) {
    tbP.innerHTML = `<tr><td colspan="5" class="empty">Preencha o campo Cliente nas contas a receber para ver a classificação de pagadores.</td></tr>`;
  } else {
    tbP.innerHTML = clientes.map(([nome, c]) => {
      let status, cls;
      if (c.maiorAtraso > 30) { status = 'Inadimplente'; cls = 'pagar'; }
      else if (c.maiorAtraso > 0) { status = 'Atenção'; cls = 'ctv'; }
      else { status = 'Em dia'; cls = 'receber'; }
      return `<tr>
        <td>${escapeHtml(nome)}</td>
        <td>${fmt(c.recebido)}</td>
        <td>${fmt(c.aberto)}</td>
        <td>${c.maiorAtraso > 0 ? c.maiorAtraso + ' dia(s)' : '—'}</td>
        <td><span class="badge ${cls}">${status}</span></td>
      </tr>`;
    }).join('');
  }
}
