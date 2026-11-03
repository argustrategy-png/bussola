// Login, cadastro, recuperação de senha e checagem de assinatura (paywall).

// ── AUTH ──────────────────────────────────────────────────
function toggleAuthMode() {
  authMode = authMode === 'login' ? 'signup' : 'login';
  document.getElementById('auth-nome-field').style.display = authMode === 'signup' ? 'block' : 'none';
  document.getElementById('auth-submit-btn').textContent = authMode === 'signup' ? 'Criar conta' : 'Entrar';
  document.getElementById('auth-mode-label').textContent = authMode === 'signup' ? 'Criar sua conta' : 'Entrar na sua conta';
  document.getElementById('auth-toggle-label').textContent = authMode === 'signup' ? 'Já tem conta?' : 'Não tem conta?';
  document.getElementById('auth-toggle-link').textContent = authMode === 'signup' ? 'Entrar' : 'Cadastre-se';
  const err = document.getElementById('auth-error');
  err.style.display = 'none'; err.style.color = 'var(--red)';
}

async function forgotPassword() {
  const email = document.getElementById('auth-email').value.trim();
  const err = document.getElementById('auth-error');
  err.style.display = 'none'; err.style.color = 'var(--red)';
  if (!email) { err.textContent = 'Informe seu e-mail para receber o link de redefinição.'; err.style.display = 'block'; return; }
  const { error } = await sb.auth.resetPasswordForEmail(email);
  if (error) { err.textContent = error.message; err.style.display = 'block'; return; }
  err.textContent = 'Enviamos um link de redefinição para ' + email + '. Confira sua caixa de entrada.';
  err.style.color = 'var(--green)'; err.style.display = 'block';
}

function enterRecoveryMode() {
  authMode = 'recovery';
  document.getElementById('auth-mode-label').textContent = 'Defina sua nova senha';
  document.getElementById('auth-google-btn').style.display = 'none';
  document.getElementById('auth-google-divider').style.display = 'none';
  document.getElementById('auth-email-field').style.display = 'none';
  document.getElementById('auth-nome-field').style.display = 'none';
  document.getElementById('auth-pass-label').textContent = 'Nova senha';
  document.getElementById('auth-pass-confirm-field').style.display = 'block';
  document.getElementById('auth-submit-btn').textContent = 'Salvar nova senha';
  document.getElementById('auth-forgot-row').style.display = 'none';
  document.getElementById('auth-switch-row').style.display = 'none';
  document.getElementById('auth-screen').style.display = 'flex';
}

async function doAuthSubmit() {
  const err = document.getElementById('auth-error');
  err.style.display = 'none'; err.style.color = 'var(--red)';

  if (authMode === 'recovery') {
    const pass = document.getElementById('auth-pass').value;
    const confirm = document.getElementById('auth-pass-confirm').value;
    if (pass.length < 8) { err.textContent = 'A senha deve ter pelo menos 8 caracteres.'; err.style.display = 'block'; return; }
    if (pass !== confirm) { err.textContent = 'As senhas não coincidem.'; err.style.display = 'block'; return; }
    const { error } = await sb.auth.updateUser({ password: pass });
    if (error) { err.textContent = error.message; err.style.display = 'block'; return; }
    err.textContent = 'Senha atualizada! Redirecionando…';
    err.style.color = 'var(--green)'; err.style.display = 'block';
    const { data: { session } } = await sb.auth.getSession();
    setTimeout(() => onAuthed(session.user), 1200);
    return;
  }

  const email = document.getElementById('auth-email').value.trim();
  const pass = document.getElementById('auth-pass').value;
  if (!email || !pass) { err.textContent = 'Preencha e-mail e senha.'; err.style.display = 'block'; return; }

  if (authMode === 'signup') {
    const nome = document.getElementById('auth-nome').value.trim();
    if (!nome) { err.textContent = 'Informe seu nome.'; err.style.display = 'block'; return; }
    if (pass.length < 8) { err.textContent = 'A senha deve ter pelo menos 8 caracteres.'; err.style.display = 'block'; return; }
    const { data: sd, error } = await sb.auth.signUp({ email, password: pass, options: { data: { nome } } });
    if (error) { err.textContent = error.message; err.style.display = 'block'; return; }
    if (!sd.session) {
      err.textContent = 'Conta criada! Verifique seu e-mail para confirmar o cadastro antes de entrar.';
      err.style.color = 'var(--green)'; err.style.display = 'block';
      return;
    }
    onAuthed(sd.user);
  } else {
    const { data: sd, error } = await sb.auth.signInWithPassword({ email, password: pass });
    if (error) {
      if (error.code === 'email_not_confirmed' || /not confirmed/i.test(error.message || '')) {
        err.innerHTML = 'Seu e-mail ainda não foi confirmado. Abra o link que enviamos para ' + escapeHtml(email) + ' (veja também o spam) ou <a onclick="reenviarConfirmacao()" style="cursor:pointer;text-decoration:underline">reenviar o link de confirmação</a>.';
      } else {
        err.textContent = 'E-mail ou senha incorretos.';
      }
      err.style.display = 'block';
      return;
    }
    onAuthed(sd.user);
  }
}

async function reenviarConfirmacao() {
  const email = document.getElementById('auth-email').value.trim();
  const err = document.getElementById('auth-error');
  const { error } = await sb.auth.resend({ type: 'signup', email });
  if (error) { err.textContent = error.message; err.style.color = 'var(--red)'; return; }
  err.textContent = 'Link de confirmação reenviado para ' + email + '. Confira sua caixa de entrada.';
  err.style.color = 'var(--green)';
}

function escolherErpAuth(erp) {
  document.querySelectorAll('.erp-pick-btn').forEach(b => b.classList.toggle('selected', b.dataset.erp === erp));
  if (erp) localStorage.setItem('meuargus_erp_preferido', erp);
  else localStorage.removeItem('meuargus_erp_preferido');
}

async function onAuthed(user) {
  currentUser = user;
  document.getElementById('auth-screen').style.display = 'none';

  const { data: perfil } = await sb.from('subscribers').select('status,plano,expira,is_admin').eq('id', user.id).single();
  perfilAssinante = perfil;
  const trialVencido = perfil?.status === 'trial' && perfil.expira && new Date(perfil.expira + 'T23:59:59') < new Date();
  if (perfil && !perfil.is_admin && (perfil.status === 'expirado' || trialVencido)) {
    if (trialVencido) sb.from('subscribers').update({ status: 'expirado' }).eq('id', user.id).then(() => {});
    showPaywall();
    return;
  }

  document.getElementById('app-content').style.display = 'block';
  document.getElementById('hd-email').textContent = user.email || '';
  iniciarContadorTrial();
  mostrarAtalhosDeModulos();
  loadData();
  handleErpRedirectParams();
  handleCheckoutRedirectParams();
  sincronizarERPsEmSegundoPlano();
  iniciarSyncPeriodicoERP();

  // Guarda a escolha feita no login (localStorage.meuargus_erp_preferido) pra
  // sempre — não só nesse primeiro acesso — pro modal de integração já abrir
  // focado nesse ERP em vez de listar os 4 igual. O "boas-vindas" (modal +
  // aviso) continua sendo só uma vez, controlado por uma flag separada.
  const erpPreferido = localStorage.getItem('meuargus_erp_preferido');
  if (erpPreferido && !localStorage.getItem('meuargus_erp_boas_vindas_feita')) {
    localStorage.setItem('meuargus_erp_boas_vindas_feita', '1');
    abrirModalImportar();
    showSync(`Você escolheu ${ERP_PROVIDERS[erpPreferido]?.label || erpPreferido} — clique em "Conectar" abaixo.`);
  }
}

async function doLogout() {
  await sb.auth.signOut();
  location.reload();
}

function showPaywall() {
  document.getElementById('paywall-screen').style.display = 'flex';
}

// Selo discreto no cabeçalho com a contagem regressiva do trial ao vivo.
// Mantém granularidade baixa (só dias/horas) enquanto falta tempo de sobra,
// e só desce pra minutos/segundos quando está mesmo no fim — um selo pequeno
// não precisa (nem deve) ficar piscando números o tempo todo.
let trialCountdownInterval = null;
function iniciarContadorTrial() {
  const badge = document.getElementById('hd-trial-badge');
  const perfil = perfilAssinante;
  if (trialCountdownInterval) { clearInterval(trialCountdownInterval); trialCountdownInterval = null; }
  if (!perfil || perfil.is_admin || perfil.status !== 'trial' || !perfil.expira) { badge.style.display = 'none'; return; }

  const alvo = new Date(perfil.expira + 'T23:59:59');
  const atualizar = () => {
    const restante = alvo - new Date();
    if (restante <= 0) { clearInterval(trialCountdownInterval); location.reload(); return; }
    const dias = Math.floor(restante / 86400000);
    const horas = Math.floor((restante % 86400000) / 3600000);
    const min = Math.floor((restante % 3600000) / 60000);
    const seg = Math.floor((restante % 60000) / 1000);
    let tempo;
    if (dias >= 1) tempo = `${dias}d ${horas}h`;
    else if (horas >= 1) tempo = `${horas}h ${min}min`;
    else if (min >= 1) tempo = `${min}min`;
    else tempo = `${seg}s`;
    badge.textContent = `⏳ Teste grátis: ${tempo}`;
    badge.classList.toggle('urgente', restante < 3 * 86400000);
  };
  atualizar();
  trialCountdownInterval = setInterval(atualizar, 1000);
  badge.style.display = 'inline-block';
}

// Núcleo compartilhado entre o botão do paywall e o do modal de assinatura —
// os dois só chamam /api/stripe/checkout com botão/erro próprios.
async function iniciarCheckout(btn, err, textoBotao) {
  err.style.display = 'none';
  btn.disabled = true; btn.textContent = 'Abrindo pagamento…';
  try {
    const { data: { session } } = await sb.auth.getSession();
    const resp = await fetch('/api/stripe/checkout', {
      method: 'POST',
      headers: { Authorization: `Bearer ${session.access_token}` },
    });
    const data = await resp.json();
    if (!resp.ok || !data.url) throw new Error(data.error || 'Falha ao iniciar pagamento');
    location.href = data.url;
  } catch (e) {
    err.textContent = 'Não foi possível iniciar o pagamento. Tente novamente em instantes.';
    err.style.display = 'block';
    btn.disabled = false; btn.textContent = textoBotao;
  }
}

async function assinarAgora() {
  await iniciarCheckout(document.getElementById('paywall-btn'), document.getElementById('paywall-error'), 'Assinar agora');
}
