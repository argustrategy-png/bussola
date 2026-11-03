// Inicialização — carregado por último.

// ─── INIT ────────────────────────────────────────────────
document.getElementById('f-venc').value = today();
toggleTocClass();
initAuth();

function refreshAll() {
  renderDashboard();
  atualizarSaldoRealCalculado();
  atualizarCotacoesLancamentos().then(() => {
    renderDashboard();
    if (document.getElementById('tab-indicadores').classList.contains('active')) { renderIndicadores(); renderInsights(); }
  });
  renderTable();
  atualizarSugestoesCategoria();
  if (document.getElementById('tab-indicadores').classList.contains('active')) { renderIndicadores(); renderInsights(); }
  if (document.getElementById('tab-cobranca').classList.contains('active')) renderCobranca();
  if (document.getElementById('tab-previsao').classList.contains('active')) renderPrevisao();
}
