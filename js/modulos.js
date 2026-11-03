// Módulos extras liberados pelo admin por cliente (tabela modulos_assinante,
// ver supabase-migration-precificacao.sql). Hoje: só a Precificação.

async function mostrarAtalhosDeModulos() {
  const btn = document.getElementById('btn-precificacao');
  if (!btn || !currentUser) return;
  const { data, error } = await sb.from('modulos_assinante').select('precificacao').eq('subscriber_id', currentUser.id).maybeSingle();
  // Erro (ex.: migração ainda não rodou) = esconde, sem incomodar o usuário.
  btn.style.display = !error && (data?.precificacao || perfilAssinante?.is_admin) ? '' : 'none';
}
