// Indicador de sincronização, carga dos lançamentos do Supabase e navegação entre abas.

// ── Sync indicator ──────────────────────────────────────
function showSync(msg, err) {
  let el = document.getElementById('sync-status');
  if (!el) {
    el = document.createElement('div');
    el.id = 'sync-status';
    el.style.cssText = 'position:fixed;bottom:16px;right:16px;padding:8px 16px;border-radius:8px;font-size:.8rem;z-index:999;transition:opacity .4s;font-family:Inter,sans-serif';
    document.body.appendChild(el);
  }
  el.style.background = err ? 'var(--red-dim)' : 'var(--green-dim)';
  el.style.color = err ? 'var(--red)' : 'var(--green)';
  el.style.border = `1px solid ${err ? 'var(--red-border)' : 'var(--green-border)'}`;
  el.style.opacity = '1';
  el.textContent = msg;
  setTimeout(() => { el.style.opacity = '0'; }, 2500);
}

// ── Load from Supabase ───────────────────────────────────
// O Supabase corta qualquer select sem paginação em 1000 linhas (limite do
// PostgREST) — silenciosamente, sem erro. Contas com mais de 1000
// lançamentos (comum depois de meses de sync com ERP) perdiam justo os mais
// recentes/futuros, já que a ordenação é do mais antigo pro mais novo — os
// cards "próx. 30d" ficavam sempre zerados (visto em produção: conta com
// 1740 lançamentos, tudo depois de ~2025 sumia). Busca em páginas de 1000
// até vir uma página incompleta.
async function loadData() {
  const PAGINA = 1000;
  let todos = [];
  for (let pagina = 0; ; pagina++) {
    const { data: rows, error } = await sb.from('lancamentos').select('*')
      .order('vencimento', { ascending: true })
      .range(pagina * PAGINA, pagina * PAGINA + PAGINA - 1);
    if (error) { showSync('Erro ao carregar dados ✗', true); return; }
    todos = todos.concat(rows || []);
    if (!rows || rows.length < PAGINA) break;
  }
  data = todos;
  refreshAll();
}

async function _insert(item) {
  const { id: _ignore, ...payload } = item;
  payload.subscriber_id = currentUser.id;
  const { data: rows, error } = await sb.from('lancamentos').insert(payload).select();
  if (error) { showSync('Erro ao salvar ✗', true); return null; }
  showSync('Salvo ✓');
  return rows[0];
}

async function _update(id, patch) {
  const { error } = await sb.from('lancamentos').update(patch).eq('id', id);
  if (error) { showSync('Erro ao atualizar ✗', true); return false; }
  showSync('Atualizado ✓');
  return true;
}

async function _delete(id) {
  const { error } = await sb.from('lancamentos').delete().eq('id', id);
  if (error) { showSync('Erro ao remover ✗', true); return false; }
  showSync('Removido ✓');
  return true;
}

function saveParams() {
  paramsState.selic = parseFloat(document.getElementById('p-selic').value) || 0;
  paramsState.cartao = parseFloat(document.getElementById('p-cartao').value) || 0;
  const margemInput = document.getElementById('p-margem').value;
  paramsState.margem = margemInput === '' ? null : parseFloat(margemInput);
  paramsState.metaMargem = parseFloat(document.getElementById('p-meta-margem').value) || 25;
  localStorage.setItem('meuargus_params', JSON.stringify(paramsState));
  document.getElementById('hero-meta-margem').textContent = paramsState.metaMargem + '%';

  checkMargemAviso();
}

// Aviso (não bloqueia) pra margem de contribuição fora da faixa comum — pega
// o caso de digitar errado (ex: "3" querendo dizer 30%) sem impedir quem
// realmente tem uma margem atípica de salvar mesmo assim.
function checkMargemAviso() {
  const avisoEl = document.getElementById('p-margem-aviso');
  if (paramsState.margem !== null && !isNaN(paramsState.margem) && (paramsState.margem < 5 || paramsState.margem > 90)) {
    avisoEl.textContent = `⚠️ ${paramsState.margem}% é uma margem incomum — confira se não é engano (ex: digitou 3 querendo dizer 30).`;
    avisoEl.style.display = 'block';
  } else {
    avisoEl.style.display = 'none';
  }
}

// ─── NAV ─────────────────────────────────────────────────
const TABS = ['dashboard','indicadores','lancamentos','cobranca','previsao'];
function showTab(id) {
  document.querySelectorAll('.tab').forEach(t => t.classList.remove('active'));
  document.querySelectorAll('nav button').forEach(b => b.classList.remove('active'));
  document.getElementById('tab-' + id).classList.add('active');
  document.querySelectorAll('nav button')[TABS.indexOf(id)].classList.add('active');
  if (id === 'dashboard') renderDashboard();
  if (id === 'indicadores') { renderIndicadores(); renderInsights(); }
  if (id === 'cobranca') renderCobranca();
  if (id === 'previsao') renderPrevisao();
  if (id === 'lancamentos') renderTable();
}

function toggleAssistentePanel() {
  const painel = document.getElementById('assistente-painel');
  painel.classList.toggle('open');
  if (painel.classList.contains('open')) document.getElementById('chat-input').focus();
}
