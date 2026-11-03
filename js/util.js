// Formatação e utilitários compartilhados. Dado que veio de fora (usuário, ERP,
// planilha) SEMPRE passa por escapeHtml antes de ir para innerHTML.

// ─── FORMAT ──────────────────────────────────────────────
function fmt(v) { return 'R$ ' + Math.abs(v).toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 }); }
function fmtSgn(v) { return (v >= 0 ? '+' : '-') + fmt(v); }
function fmtCompact(v) { return v >= 1000 ? 'R$' + (v / 1000).toLocaleString('pt-BR', { maximumFractionDigits: 1 }) + 'k' : 'R$' + Math.round(v); }
function fmtDate(d) { if (!d) return '—'; const [y,m,dd] = d.split('-'); return `${dd}/${m}/${y}`; }
function today() { return new Date().toISOString().split('T')[0]; }
function addDays(dateStr, n) { const d = new Date(dateStr + 'T12:00:00'); d.setDate(d.getDate() + n); return d.toISOString().split('T')[0]; }
function uid() { return Math.random().toString(36).slice(2) + Date.now().toString(36); }
function mesesDistintosPagos() {
  const meses = new Set();
  data.filter(r => r.status === 'pago' && r.vencimento).forEach(r => meses.add(r.vencimento.slice(0,7)));
  return Math.max(1, meses.size);
}


function escapeHtml(s) {
  return String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}
