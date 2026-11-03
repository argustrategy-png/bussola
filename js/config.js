// Configuração do Supabase e tema claro/escuro.

// ══════════════════════════════════════════════
// ⚙️  CONFIGURAÇÃO SUPABASE
// ══════════════════════════════════════════════
const SUPABASE_URL = 'https://ijbzdhpfhusckvoecdjw.supabase.co';
const SUPABASE_KEY = 'sb_publishable_hJhexGzbi1soGSnlXwgQMA_wkQG9_yk';
// ══════════════════════════════════════════════

const sb = supabase.createClient(SUPABASE_URL, SUPABASE_KEY);

// ─── TEMA ────────────────────────────────────────────────
function applyTheme(mode) {
  document.documentElement.setAttribute('data-theme', mode);
  const icon = mode === 'dark' ? '☀️' : '🌙';
  const a = document.getElementById('theme-toggle-auth'); if (a) a.textContent = icon;
  const b = document.getElementById('theme-toggle-app');  if (b) b.textContent = icon;
}
function toggleTheme() {
  const cur = document.documentElement.getAttribute('data-theme') === 'dark' ? 'dark' : 'light';
  const next = cur === 'dark' ? 'light' : 'dark';
  localStorage.setItem('meuargus_theme', next);
  applyTheme(next);
}
(function initTheme() {
  const saved = localStorage.getItem('meuargus_theme');
  applyTheme(saved === 'dark' ? 'dark' : 'light');
})();
