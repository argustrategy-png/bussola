// Modal de assinatura: antecipar pagamento e trocar forma de pagamento (Stripe).

// ─── MODAL DE ASSINATURA (antecipar pagamento / trocar forma de pagamento) ──
function abrirModalAssinatura() {
  const statusEl = document.getElementById('assinatura-status');
  const btnAssinar = document.getElementById('btn-assinar-agora');
  const btnPortal = document.getElementById('btn-portal-stripe');
  document.getElementById('assinatura-error').style.display = 'none';
  const perfil = perfilAssinante;

  if (perfil?.status === 'ativo') {
    statusEl.textContent = 'Sua assinatura MeuArgus Pro está ativa. Você pode trocar o cartão ou a forma de pagamento a qualquer momento.';
    btnAssinar.style.display = 'none';
    btnPortal.style.display = 'block'; btnPortal.disabled = false; btnPortal.textContent = 'Alterar forma de pagamento';
  } else if (perfil?.status === 'trial') {
    const hoje = new Date(); hoje.setHours(0, 0, 0, 0);
    const alvo = perfil.expira ? new Date(perfil.expira + 'T00:00:00') : null;
    const dias = alvo ? Math.round((alvo - hoje) / 86400000) : null;
    statusEl.textContent = dias != null
      ? `Você ainda está no período de teste grátis (${dias > 0 ? `termina em ${dias} dia(s)` : 'termina hoje'}). Quer começar a pagar agora e não se preocupar mais com isso?`
      : 'Você está no período de teste grátis. Quer assinar agora?';
    btnAssinar.style.display = 'block'; btnAssinar.disabled = false; btnAssinar.textContent = 'Assinar agora';
    btnPortal.style.display = 'none';
  } else {
    statusEl.textContent = 'Assine o MeuArgus Pro pra continuar usando o painel e as integrações com ERP.';
    btnAssinar.style.display = 'block'; btnAssinar.disabled = false; btnAssinar.textContent = 'Assinar agora';
    btnPortal.style.display = 'none';
  }

  carregarDadosPessoais();
  document.getElementById('conta-novo-email').value = '';
  document.getElementById('conta-nova-senha').value = '';
  document.getElementById('conta-confirma-senha').value = '';
  ['conta-dados-msg', 'conta-email-msg', 'conta-senha-msg'].forEach(id => { document.getElementById(id).style.display = 'none'; });

  document.getElementById('modal-assinatura').classList.add('open');
}
function fecharModalAssinatura() { document.getElementById('modal-assinatura').classList.remove('open'); }

function abrirModalImportar() { renderErpLista(); document.getElementById('modal-importar').classList.add('open'); }
function fecharModalImportar() { document.getElementById('modal-importar').classList.remove('open'); }

async function carregarDadosPessoais() {
  const { data } = await sb.from('subscribers').select('nome,empresa,tel').eq('id', currentUser.id).single();
  document.getElementById('conta-nome').value = data?.nome || '';
  document.getElementById('conta-empresa').value = data?.empresa || '';
  document.getElementById('conta-telefone').value = data?.tel || '';
}

function mostrarMsgConta(id, texto, ehErro) {
  const el = document.getElementById(id);
  el.textContent = texto;
  el.style.color = ehErro ? 'var(--red)' : 'var(--green)';
  el.style.display = 'block';
}

async function salvarDadosPessoais() {
  const nome = document.getElementById('conta-nome').value.trim();
  const empresa = document.getElementById('conta-empresa').value.trim();
  const tel = document.getElementById('conta-telefone').value.trim();
  if (!nome) { mostrarMsgConta('conta-dados-msg', 'Informe seu nome.', true); return; }
  const { error } = await sb.from('subscribers').update({ nome, empresa: empresa || null, tel: tel || null }).eq('id', currentUser.id);
  if (error) mostrarMsgConta('conta-dados-msg', 'Não consegui salvar. Tente de novo.', true);
  else mostrarMsgConta('conta-dados-msg', 'Dados salvos ✓', false);
}

async function salvarNovoEmail() {
  const email = document.getElementById('conta-novo-email').value.trim();
  if (!email) { mostrarMsgConta('conta-email-msg', 'Informe o novo e-mail.', true); return; }
  const { error } = await sb.auth.updateUser({ email });
  if (error) mostrarMsgConta('conta-email-msg', error.message, true);
  else mostrarMsgConta('conta-email-msg', `Enviamos um link de confirmação pra ${email}. A troca só vale depois de confirmar.`, false);
}

async function salvarNovaSenhaConta() {
  const nova = document.getElementById('conta-nova-senha').value;
  const confirma = document.getElementById('conta-confirma-senha').value;
  if (nova.length < 8) { mostrarMsgConta('conta-senha-msg', 'A senha deve ter pelo menos 8 caracteres.', true); return; }
  if (nova !== confirma) { mostrarMsgConta('conta-senha-msg', 'As senhas não coincidem.', true); return; }
  const { error } = await sb.auth.updateUser({ password: nova });
  if (error) { mostrarMsgConta('conta-senha-msg', error.message, true); return; }
  mostrarMsgConta('conta-senha-msg', 'Senha alterada ✓', false);
  document.getElementById('conta-nova-senha').value = '';
  document.getElementById('conta-confirma-senha').value = '';
}

async function assinarAgoraModal() {
  await iniciarCheckout(document.getElementById('btn-assinar-agora'), document.getElementById('assinatura-error'), 'Assinar agora');
}

async function abrirPortalStripe() {
  const btn = document.getElementById('btn-portal-stripe');
  const err = document.getElementById('assinatura-error');
  err.style.display = 'none';
  btn.disabled = true; btn.textContent = 'Abrindo...';
  try {
    const { data: { session } } = await sb.auth.getSession();
    const resp = await fetch('/api/stripe/portal', {
      method: 'POST',
      headers: { Authorization: `Bearer ${session.access_token}` },
    });
    const data = await resp.json();
    if (!resp.ok || !data.url) throw new Error(data.error || 'Falha ao abrir portal');
    location.href = data.url;
  } catch (e) {
    err.textContent = 'Não foi possível abrir a gestão de pagamento agora. Tente novamente em instantes.';
    err.style.display = 'block';
    btn.disabled = false; btn.textContent = 'Alterar forma de pagamento';
  }
}

function handleCheckoutRedirectParams() {
  const params = new URLSearchParams(location.search);
  if (params.get('checkout') === 'sucesso') showSync('Assinatura confirmada ✓');
  if (params.get('checkout') === 'cancelado') showSync('Pagamento cancelado.', true);
  if (params.has('checkout')) history.replaceState({}, '', location.pathname);
}

async function initAuth() {
  const { data: { session } } = await sb.auth.getSession();
  if (session) onAuthed(session.user);
  else document.getElementById('auth-screen').style.display = 'flex';
}

sb.auth.onAuthStateChange((event) => {
  if (event === 'PASSWORD_RECOVERY') enterRecoveryMode();
});

async function loginComGoogle() {
  const { error } = await sb.auth.signInWithOAuth({ provider: 'google', options: { redirectTo: window.location.origin + '/app' } });
  if (error) {
    const err = document.getElementById('auth-error');
    err.textContent = 'Não foi possível iniciar o login com Google.';
    err.style.color = 'var(--red)'; err.style.display = 'block';
  }
}
