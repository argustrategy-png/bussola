// Aba Lançamentos: formulário e tabela.

// ─── FORM ────────────────────────────────────────────────
function toggleTocClass() {
  const isPagar = document.getElementById('f-tipo').value === 'pagar';
  document.getElementById('toc-class-label').style.display = isPagar ? 'flex' : 'none';
  const cpLabel = document.getElementById('contraparte-label');
  cpLabel.childNodes[0].textContent = isPagar ? 'Fornecedor' : 'Cliente';
  document.getElementById('f-contraparte').placeholder = isPagar ? 'Nome do fornecedor' : 'Nome do cliente';
  atualizarSugestoesCategoria();
}

// Sugestões de categoria pro campo "Categoria": uma lista padrão pra cada
// tipo de lançamento, somada às categorias que o usuário já usou (digitadas
// ou vindas do ERP), pra régua ficar mais útil com o tempo sem exigir cadastro prévio.
const CATEGORIAS_PADRAO = {
  pagar: ['Aluguel', 'Fornecedores', 'Salários', 'Pró-labore', 'Impostos', 'Energia elétrica', 'Água', 'Internet/Telefone', 'Marketing', 'Frete', 'Manutenção', 'Material de escritório', 'Software/Assinaturas', 'Combustível', 'Empréstimos/Financiamento'],
  receber: ['Vendas', 'Serviços prestados', 'Mensalidade', 'Comissão', 'Juros recebidos', 'Reembolso'],
};

function atualizarSugestoesCategoria() {
  const tipo = document.getElementById('f-tipo').value;
  const usadas = data.filter(r => r.tipo === tipo && r.categoria).map(r => r.categoria);
  const lista = [...new Set([...CATEGORIAS_PADRAO[tipo], ...usadas])];
  const esc = s => s.replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;');
  document.getElementById('f-cat-list').innerHTML = lista.map(c => `<option value="${esc(c)}">`).join('');
}

async function addLancamento() {
  const tipo = document.getElementById('f-tipo').value;
  const desc = document.getElementById('f-desc').value.trim();
  const valor = parseFloat(document.getElementById('f-valor').value);
  const venc = document.getElementById('f-venc').value;
  const cat = document.getElementById('f-cat').value.trim();
  const contraparte = document.getElementById('f-contraparte').value.trim();
  const telefone = document.getElementById('f-telefone').value.trim();
  const rec = document.getElementById('f-rec').value;
  const toc = tipo === 'pagar' ? document.getElementById('f-toc').value : 'na';
  if (!desc) { alert('Informe a descrição.'); return; }
  if (!valor || valor <= 0) { alert('Informe um valor válido.'); return; }
  if (!venc) { alert('Informe o vencimento.'); return; }
  const base = { tipo, descricao: desc, valor, vencimento: venc, categoria: cat || null, contraparte: contraparte || null, contraparte_telefone: telefone || null, status: 'pendente', recorrencia: rec, toc, origem: 'manual', subscriber_id: currentUser.id };
  const items = [{ ...base }];
  if (rec !== 'none') {
    const steps = { semanal:7, quinzenal:15, mensal:30 };
    for (let i = 1; i <= 11; i++) items.push({ ...base, vencimento: addDays(venc, steps[rec]*i) });
  }
  const { data: rows, error } = await sb.from('lancamentos').insert(items).select();
  if (error) { showSync('Erro ao salvar ✗', true); return; }
  data.push(...(rows||[]));
  showSync(`${rows.length} lançamento(s) adicionado(s) ✓`);
  clearForm(); renderTable(); refreshAll();
}

function clearForm() {
  ['f-desc','f-valor','f-venc','f-cat','f-contraparte','f-telefone'].forEach(id => document.getElementById(id).value = '');
  document.getElementById('f-tipo').value = 'receber';
  document.getElementById('f-rec').value = 'none';
  document.getElementById('f-toc').value = 'do';
  toggleTocClass();
}

// ─── TABLE ───────────────────────────────────────────────
function renderTable() {
  const fil = document.getElementById('fil-tipo').value;
  const filS = document.getElementById('fil-status').value;
  const busca = document.getElementById('fil-busca').value.toLowerCase();
  const t = today();
  const rows = data.filter(r => {
    if (fil && r.tipo !== fil) return false;
    if (filS && r.status !== filS) return false;
    if (busca && !r.descricao.toLowerCase().includes(busca) && !(r.categoria||'').toLowerCase().includes(busca)) return false;
    return true;
  }).sort((a,b) => (a.vencimento||'') < (b.vencimento||'') ? -1 : 1);

  const tb = document.getElementById('tb-body');
  if (rows.length === 0) { tb.innerHTML = `<tr><td colspan="9" class="empty">Nenhum lançamento encontrado.</td></tr>`; return; }
  tb.innerHTML = rows.map(r => {
    const vencido = r.vencimento < t && r.status !== 'pago';
    const tocBadge = r.tipo === 'pagar' ? `<span class="badge ${r.toc||'do'}">${r.toc === 'ctv' ? 'Variável' : 'Fixo'}</span>` : '—';
    return `<tr class="${r.status==='pago'?'row-paid':''}">
      <td><span class="badge ${r.tipo}">${r.tipo==='receber'?'Receber':'Pagar'}</span></td>
      <td>${escapeHtml(r.descricao)}${r.recorrencia&&r.recorrencia!=='none'?` <span class="tag-status">↻${escapeHtml(r.recorrencia)}</span>`:''}</td>
      <td>${escapeHtml(r.categoria||'—')}</td>
      <td>${escapeHtml(r.contraparte||'—')}</td>
      <td style="${vencido?'color:var(--red);font-weight:600':''}">${fmtDate(r.vencimento)}</td>
      <td>${fmt(r.valor)}</td>
      <td>${tocBadge}</td>
      <td><button onclick="toggleStatus('${r.id}')" style="background:none;border:none;cursor:pointer;font-size:0.82rem;color:var(--text2);font-family:Inter,sans-serif">${r.status==='pago'?'✅ Pago':'⏳ Pendente'}</button></td>
      <td><button class="btn btn-danger" onclick="removeItem('${r.id}')">✕</button></td>
    </tr>`;
  }).join('');
}

async function toggleStatus(id) {
  const r = data.find(r => r.id === id);
  if (!r) return;
  const newStatus = r.status === 'pago' ? 'pendente' : 'pago';
  const ok = await _update(id, { status: newStatus });
  if (ok) { r.status = newStatus; renderTable(); renderDashboard(); }
}
async function removeItem(id) {
  if (!confirm('Remover este lançamento?')) return;
  const ok = await _delete(id);
  if (ok) { data = data.filter(r => r.id !== id); renderTable(); refreshAll(); }
}
