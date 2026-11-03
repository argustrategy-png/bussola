// Integração com ERPs: conexão, status, sincronização e mensagens de erro.

// ─── INTEGRAÇÃO COM ERPs (biblioteca multi-provedor) ─────
// Bling já está pré-configurado. ContaAzul/QuickBooks aguardam Client ID
// (falta cadastrar o app em cada plataforma). Omie não usa OAuth2 — conecta
// direto com App Key/Secret.
const ERP_PROVIDERS = {
  bling:      { label: 'Bling',      authType: 'oauth2', clientId: 'acd71403a8266b456faa3457870ba113292267a1', authorizeUrl: 'https://www.bling.com.br/Api/v3/oauth/authorize' },
  contaazul:  { label: 'Conta Azul', authType: 'oauth2', clientId: null, authorizeUrl: 'https://api.contaazul.com/auth/authorize' },
  quickbooks: { label: 'QuickBooks', authType: 'oauth2', clientId: null, authorizeUrl: 'https://appcenter.intuit.com/connect/oauth2' },
  omie:       { label: 'Omie',       authType: 'apikey', credentialFields: [
    { name: 'appKey', label: 'App Key', type: 'text' },
    { name: 'appSecret', label: 'App Secret', type: 'password' },
  ]},
  odoo:       { label: 'Odoo',       authType: 'apikey', credentialFields: [
    { name: 'url', label: 'URL da instância', type: 'text', placeholder: 'https://suaempresa.odoo.com' },
    { name: 'db', label: 'Banco de dados', type: 'text' },
    { name: 'username', label: 'Usuário (e-mail)', type: 'text' },
    { name: 'apiKey', label: 'API Key', type: 'password' },
  ]},
};
let erpStatusAtual = {};
let erpStatusCarregado = false;
let apikeyProviderAtual = null;

async function erpAuthHeader() {
  const { data: { session } } = await sb.auth.getSession();
  return { Authorization: `Bearer ${session.access_token}`, 'Content-Type': 'application/json' };
}


async function conectarERP(provider) {
  const cfg = ERP_PROVIDERS[provider];
  if (cfg.authType === 'apikey') { openApiKeyModal(provider); return; }
  if (!cfg.clientId) { showSync(`${cfg.label} ainda não está configurado nesta conta (falta cadastrar o app e o Client ID).`, true); return; }
  // O state é emitido e assinado pelo servidor (junto com um cookie deste
  // navegador) — ver api/_lib/oauth-state.js.
  let state;
  try {
    const resp = await fetch('/api/erp/status', { method: 'POST', headers: await erpAuthHeader(), body: JSON.stringify({ action: 'oauth_state', provider }) });
    if (!resp.ok) throw new Error(resp.status);
    state = (await resp.json()).state;
  } catch (e) {
    showSync(`Não foi possível iniciar a conexão com ${cfg.label}. Tente novamente.`, true);
    return;
  }
  const redirectUri = `${location.origin}/api/${provider}/callback`;
  const url = `${cfg.authorizeUrl}?response_type=code&client_id=${encodeURIComponent(cfg.clientId)}&state=${encodeURIComponent(state)}&redirect_uri=${encodeURIComponent(redirectUri)}`;
  location.href = url;
}

async function checkErpStatus() {
  try {
    const resp = await fetch('/api/erp/status', { headers: await erpAuthHeader() });
    if (!resp.ok) { renderErpLista(); return; }
    const data = await resp.json();
    erpStatusAtual = {};
    (data.integracoes || []).forEach(i => { erpStatusAtual[i.provider] = i; });
    erpStatusCarregado = true;
    renderErpLista();
  } catch (e) { renderErpLista(); }
}

// Mantém os lançamentos do ERP em dia sem depender do usuário lembrar de
// clicar em "Sincronizar agora": ao abrir o app, e depois a cada 1 hora,
// sincroniza (sem toast, sem barulho) quem estiver conectado e desatualizado.
// Só roda com a aba em primeiro plano, pra não gastar chamada à API à toa.
const ERP_SYNC_INTERVAL_MS = 60 * 60 * 1000;
async function sincronizarERPsEmSegundoPlano() {
  if (document.visibilityState !== 'visible') return;
  await checkErpStatus();
  const agora = Date.now();
  const pendentes = Object.entries(erpStatusAtual).filter(([, integ]) => {
    const ultima = integ.ultima_sincronizacao ? new Date(integ.ultima_sincronizacao).getTime() : 0;
    return agora - ultima >= ERP_SYNC_INTERVAL_MS;
  });
  if (!pendentes.length) return;
  for (const [provider] of pendentes) {
    try {
      const resp = await fetch('/api/erp/sync', { method: 'POST', headers: await erpAuthHeader(), body: JSON.stringify({ provider }) });
      if (resp.ok) await loadData();
    } catch (e) { console.error('sync automático falhou', provider, e); }
  }
  await checkErpStatus();
}

let erpSyncTimer = null;
function iniciarSyncPeriodicoERP() {
  if (erpSyncTimer) clearInterval(erpSyncTimer);
  erpSyncTimer = setInterval(sincronizarERPsEmSegundoPlano, ERP_SYNC_INTERVAL_MS);
}

function renderCartaoErp(key, cfg) {
  const conectado = erpStatusAtual[key];
  if (conectado) {
    const syncTxt = conectado.ultima_sincronizacao
      ? `Última sincronização: ${new Date(conectado.ultima_sincronizacao).toLocaleString('pt-BR')}`
      : 'Ainda não sincronizado — clique em "Sincronizar agora".';
    return `<div class="erp-note">🔌 <div>
      <strong>${cfg.label} conectado.</strong> ${syncTxt}
      <div style="margin-top:10px;display:flex;gap:10px">
        <button class="btn btn-primary" onclick="sincronizarERP('${key}')">Sincronizar agora</button>
        <button class="btn btn-secondary" onclick="desconectarERP('${key}')">Desconectar</button>
      </div>
    </div></div>`;
  }
  return `<div class="erp-note">🔌 <div>
    <strong>Conectar ${cfg.label}</strong>
    <div style="margin-top:10px"><button class="btn btn-primary" onclick="conectarERP('${key}')">Conectar com ${cfg.label}</button></div>
  </div></div>`;
}

// A grande maioria dos assinantes usa um ERP só. Em vez de listar os 4 com o
// mesmo peso, destaca o que já está conectado (ou o que a pessoa escolheu no
// login) e esconde o resto atrás de "usa outro sistema?" — só quem
// realmente precisa clica pra ver as outras opções.
function renderErpLista() {
  const box = document.getElementById('erp-lista');
  document.getElementById('erp-banner').style.display = erpStatusCarregado && !Object.keys(erpStatusAtual).length ? 'flex' : 'none';
  const conectadoKey = Object.keys(erpStatusAtual)[0] || null;
  const preferido = localStorage.getItem('meuargus_erp_preferido');
  const destaqueKey = conectadoKey || (preferido && ERP_PROVIDERS[preferido] ? preferido : null);

  if (!destaqueKey) {
    box.innerHTML = Object.entries(ERP_PROVIDERS).map(([key, cfg]) => renderCartaoErp(key, cfg)).join('');
    return;
  }

  const outros = Object.entries(ERP_PROVIDERS).filter(([key]) => key !== destaqueKey);
  box.innerHTML = renderCartaoErp(destaqueKey, ERP_PROVIDERS[destaqueKey]) + `
    <details class="erp-outros">
      <summary>Usa outro sistema, ou quer trocar? <a href="https://wa.me/551152256779?text=${encodeURIComponent('Olá! Preciso de ajuda para conectar meu ERP no MeuArgus.')}" target="_blank" rel="noopener" class="erp-fale-conosco" onclick="event.stopPropagation()">Fale conosco</a></summary>
      <div style="margin-top:12px">${outros.map(([key, cfg]) => renderCartaoErp(key, cfg)).join('')}</div>
    </details>`;
}

async function sincronizarERP(provider) {
  showSync(`Sincronizando ${ERP_PROVIDERS[provider].label}…`);
  try {
    const resp = await fetch('/api/erp/sync', { method: 'POST', headers: await erpAuthHeader(), body: JSON.stringify({ provider }) });
    const data = await resp.json();
    if (!resp.ok) { showSync('Erro ao sincronizar: ' + (data.error || ''), true); }
    else { showSync(`${data.sincronizados} lançamento(s) sincronizado(s) ✓`); await loadData(); await checkErpStatus(); }
  } catch (e) { showSync('Erro ao sincronizar ✗', true); }
}

async function desconectarERP(provider) {
  if (!confirm(`Desconectar ${ERP_PROVIDERS[provider].label}? Os lançamentos já sincronizados continuam salvos.`)) return;
  await fetch('/api/erp/disconnect', { method: 'POST', headers: await erpAuthHeader(), body: JSON.stringify({ provider }) });
  await checkErpStatus();
}

function openApiKeyModal(provider) {
  apikeyProviderAtual = provider;
  document.getElementById('apikey-titulo').textContent = 'Conectar ' + ERP_PROVIDERS[provider].label;
  const campos = ERP_PROVIDERS[provider].credentialFields || [];
  document.getElementById('apikey-fields').innerHTML = campos.map(c =>
    `<div class="form-field"><label>${c.label}</label><input id="apikey-field-${c.name}" type="${c.type || 'text'}" placeholder="${c.placeholder || ''}"></div>`
  ).join('');
  document.getElementById('apikey-error').style.display = 'none';
  document.getElementById('modal-apikey').classList.add('open');
}
function closeApiKeyModal() { document.getElementById('modal-apikey').classList.remove('open'); }

async function confirmarApiKey() {
  const campos = ERP_PROVIDERS[apikeyProviderAtual].credentialFields || [];
  const err = document.getElementById('apikey-error');
  err.style.display = 'none';
  const valores = {};
  campos.forEach(c => { valores[c.name] = document.getElementById(`apikey-field-${c.name}`).value.trim(); });
  if (campos.some(c => !valores[c.name])) {
    err.textContent = 'Preencha todos os campos.';
    err.style.display = 'block';
    return;
  }
  const resp = await fetch('/api/erp/connect-apikey', {
    method: 'POST', headers: await erpAuthHeader(),
    body: JSON.stringify({ provider: apikeyProviderAtual, ...valores }),
  });
  const data = await resp.json();
  if (!resp.ok) {
    err.textContent = data.error === 'ja_conectado_em_outra_conta'
      ? 'Essa conta já está conectada em outra conta MeuArgus.'
      : 'Não foi possível conectar — confira os dados informados.';
    err.style.display = 'block';
    return;
  }
  closeApiKeyModal();
  showSync(`${ERP_PROVIDERS[apikeyProviderAtual].label} conectado ✓`);
  await checkErpStatus();
}

document.getElementById('modal-apikey').addEventListener('click', e => { if (e.target === e.currentTarget) closeApiKeyModal(); });
document.getElementById('modal-assinatura').addEventListener('click', e => { if (e.target === e.currentTarget) fecharModalAssinatura(); });
document.getElementById('modal-importar').addEventListener('click', e => { if (e.target === e.currentTarget) fecharModalImportar(); });

const ERP_ERROS = {
  ja_conectado: 'Essa conta já está conectada a outra conta MeuArgus. Cada empresa só pode estar ligada a uma única conta.',
  iniciar_pelo_meuargus: 'Para conectar, entre no MeuArgus, clique em 🔌 Integrações e depois em "Conectar" no seu ERP.',
  token_exchange_failed: 'Não foi possível concluir a autorização. Tente conectar novamente.',
  save_failed: 'Erro ao salvar a conexão. Tente novamente em instantes.',
  conta_nao_verificada: 'Não foi possível confirmar sua empresa. Por segurança, a conexão foi cancelada. Tente novamente.',
  state_invalido: 'A autorização expirou ou não foi iniciada neste navegador. Clique em "Conectar" de novo pelo MeuArgus.',
};

function handleErpRedirectParams() {
  const params = new URLSearchParams(location.search);
  const provider = params.get('provider');
  const label = (provider && ERP_PROVIDERS[provider]) ? ERP_PROVIDERS[provider].label : 'ERP';
  if (params.get('erp_conectado')) { showSync(`${label} conectado ✓`); checkErpStatus(); }
  if (params.get('erp_erro')) {
    const codigo = params.get('erp_erro');
    showSync(ERP_ERROS[codigo] || (`Erro ao conectar ${label}: ${codigo}`), true);
  }
  if (params.has('erp_conectado') || params.has('erp_erro')) {
    history.replaceState({}, '', location.pathname);
  }
}
