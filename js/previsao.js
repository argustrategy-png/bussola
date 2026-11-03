// Aba Previsão.

// ─── PREVISÃO ────────────────────────────────────────────
function renderPrevisao() {
  const now = new Date();
  const months = Array.from({length:6}, (_,i) => {
    const d = new Date(now.getFullYear(), now.getMonth()+i, 1);
    return d.toISOString().slice(0,7);
  });
  let acum = 0;
  data.filter(r=>r.status==='pago').forEach(r => { acum += r.tipo==='receber'?r.valor:-r.valor; });
  const rows = months.map(mk => {
    const ent = data.filter(r=>r.status!=='pago'&&r.vencimento&&r.vencimento.startsWith(mk)&&r.tipo==='receber').reduce((s,r)=>s+r.valor,0);
    const sai = data.filter(r=>r.status!=='pago'&&r.vencimento&&r.vencimento.startsWith(mk)&&r.tipo==='pagar').reduce((s,r)=>s+r.valor,0);
    const liq = ent-sai; acum += liq;
    return {mk,ent,sai,liq,acum};
  });
  const labels = rows.map(r => { const [y,m] = r.mk.split('-'); return ['Jan','Fev','Mar','Abr','Mai','Jun','Jul','Ago','Set','Out','Nov','Dez'][+m-1]+'/'+y.slice(2); });
  if (chartPrevisao) chartPrevisao.destroy();
  const isDark = document.documentElement.getAttribute('data-theme') === 'dark';
  const tickColor = isDark ? '#7B9DC0' : '#64748B';
  const gridColor = isDark ? '#1E2F45' : '#E2E8F0';
  chartPrevisao = new Chart(document.getElementById('chartPrevisao'), {
    type: 'bar',
    data: { labels, datasets: [
      { label: 'Entradas', data: rows.map(r=>r.ent), backgroundColor: 'rgba(22,163,74,0.55)' },
      { label: 'Saídas', data: rows.map(r=>r.sai), backgroundColor: 'rgba(220,38,38,0.55)' },
      { label: 'Saldo Acum.', data: rows.map(r=>r.acum), type: 'line', borderColor: '#2563EB', borderWidth: 2, backgroundColor: 'transparent', tension: 0.3 }
    ]},
    options: { responsive:true, maintainAspectRatio:false,
      plugins:{ legend:{position:'bottom', labels:{color:tickColor}}, tooltip:{callbacks:{label:ctx=>ctx.dataset.label+': '+fmt(ctx.raw)}}},
      scales:{y:{ticks:{callback:v=>fmt(v),color:tickColor},grid:{color:gridColor}},x:{ticks:{color:tickColor},grid:{color:gridColor}}}
    }
  });
  document.getElementById('tb-forecast').innerHTML = rows.map((r,i) => `
    <tr>
      <td>${labels[i]}</td>
      <td class="pos">${fmt(r.ent)}</td>
      <td class="neg">${fmt(r.sai)}</td>
      <td class="${r.liq>=0?'pos':'neg'}">${fmtSgn(r.liq)}</td>
      <td class="${r.acum>=0?'pos':'neg'}">${fmtSgn(r.acum)}</td>
    </tr>`).join('');
}
