// Assistente de IA (chat).

// ─── ASSISTENTE ──────────────────────────────────────────
let chatHistory = [];
let chatEnviando = false;


// Markdown simples pra resposta do assistente: negrito, cabeçalhos, listas e
// linha horizontal — só o que o modelo realmente usa, sem puxar uma
// biblioteca de markdown completa (tabelas/código não aparecem nesse chat).
function formatInline(texto) {
  return texto
    .replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>')
    .replace(/(?<!\*)\*([^*]+?)\*(?!\*)/g, '<em>$1</em>');
}

function renderMarkdownSimples(texto) {
  const linhas = escapeHtml(texto).split('\n');
  let html = '';
  let dentroLista = false;
  const fecharLista = () => { if (dentroLista) { html += '</ul>'; dentroLista = false; } };
  for (let linha of linhas) {
    linha = linha.trim();
    if (linha === '' ) { fecharLista(); continue; }
    if (/^---+$/.test(linha)) { fecharLista(); html += '<hr>'; continue; }
    const item = linha.match(/^[*-]\s+(.*)/);
    if (item) {
      if (!dentroLista) { html += '<ul>'; dentroLista = true; }
      html += `<li>${formatInline(item[1])}</li>`;
      continue;
    }
    fecharLista();
    const cabecalho = linha.match(/^#{1,6}\s+(.*)/);
    const conteudo = cabecalho ? cabecalho[1] : linha;
    const formatado = formatInline(conteudo);
    html += cabecalho ? `<p class="chat-heading">${formatado}</p>` : `<p>${formatado}</p>`;
  }
  fecharLista();
  return html;
}

function chatAdicionarMensagem(role, texto) {
  const box = document.getElementById('chat-mensagens');
  const div = document.createElement('div');
  div.className = 'chat-msg ' + (role === 'user' ? 'chat-msg-user' : 'chat-msg-assistant');
  if (role === 'user') div.textContent = texto;
  else div.innerHTML = renderMarkdownSimples(texto);
  box.appendChild(div);
  box.scrollTop = box.scrollHeight;
  return div;
}

async function enviarPerguntaAssistente() {
  if (chatEnviando) return;
  const input = document.getElementById('chat-input');
  const pergunta = input.value.trim();
  if (!pergunta) return;

  const erroEl = document.getElementById('chat-erro');
  erroEl.style.display = 'none';
  chatAdicionarMensagem('user', pergunta);
  input.value = '';
  chatEnviando = true;
  document.getElementById('chat-enviar').disabled = true;
  const pensando = chatAdicionarMensagem('assistant', 'Pensando...');
  pensando.classList.add('chat-msg-pensando');

  try {
    const resp = await fetch('/api/assistant/ask', {
      method: 'POST',
      headers: await erpAuthHeader(),
      body: JSON.stringify({ message: pergunta, history: chatHistory }),
    });
    const data = await resp.json();
    pensando.remove();
    if (!resp.ok) {
      erroEl.textContent = 'Não consegui responder agora — tenta de novo em instantes.';
      erroEl.style.display = 'block';
      return;
    }
    chatHistory = data.history || chatHistory;
    chatAdicionarMensagem('assistant', data.reply || '(sem resposta)');
  } catch (e) {
    pensando.remove();
    erroEl.textContent = 'Não consegui responder agora — tenta de novo em instantes.';
    erroEl.style.display = 'block';
  } finally {
    chatEnviando = false;
    document.getElementById('chat-enviar').disabled = false;
    input.focus();
  }
}
