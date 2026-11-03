// Importação de planilhas (CSV/XLSX) e exportação.

// ─── IMPORT ──────────────────────────────────────────────
function handleDrop(e) { e.preventDefault(); document.getElementById('drop-area').classList.remove('drag'); handleFile(e.dataTransfer.files[0]); }

// Divide uma linha de CSV respeitando campos entre aspas (ex: "Aluguel, sala 2")
// — um split ingênuo pelo separador quebraria esse tipo de descrição ao meio.
function splitLinhaCSV(linha, sep) {
  const out = [];
  let atual = '', entreAspas = false;
  for (let i = 0; i < linha.length; i++) {
    const ch = linha[i];
    if (entreAspas) {
      if (ch === '"') { if (linha[i + 1] === '"') { atual += '"'; i++; } else entreAspas = false; }
      else atual += ch;
    } else if (ch === '"') entreAspas = true;
    else if (ch === sep) { out.push(atual.trim()); atual = ''; }
    else atual += ch;
  }
  out.push(atual.trim());
  return out;
}

function handleFile(file) {
  if (!file) return;
  hideImportError();
  const ext = (file.name.split('.').pop() || '').toLowerCase();
  if (ext === 'xlsx' || ext === 'xls') {
    const r = new FileReader();
    r.onload = e => {
      try {
        const wb = XLSX.read(new Uint8Array(e.target.result), { type: 'array', cellDates: true });
        processRows(linhasDaAbaCerta(wb));
      } catch (err) {
        showImportError('Não consegui abrir esse arquivo. Confira se é mesmo uma planilha Excel (.xlsx) e tente de novo.');
      }
    };
    r.readAsArrayBuffer(file);
  } else {
    const r = new FileReader();
    r.onload = e => {
      const text = e.target.result;
      const lines = text.trim().split(/\r?\n/);
      const sep = lines[0].includes(';') ? ';' : ',';
      const rows = lines.filter(l => l.trim()).map(l => splitLinhaCSV(l, sep));
      processRows(rows);
    };
    r.readAsText(file, 'UTF-8');
  }
}

// Converte texto ou número em valor numérico, aceitando formato brasileiro
// (1.500,00) e americano (1500.00) sem confundir separador de milhar com decimal.
function parseValorBR(raw) {
  if (typeof raw === 'number') return raw;
  let s = String(raw ?? '').trim();
  if (!s) return NaN;
  s = s.replace(/[^\d.,-]/g, '');
  const hasComma = s.includes(','), hasDot = s.includes('.');
  if (hasComma && hasDot) {
    s = s.replace(/\./g, '').replace(',', '.');
  } else if (hasComma && !hasDot) {
    s = s.replace(',', '.');
  } else if (hasDot && !hasComma) {
    const parts = s.split('.');
    if (parts.length > 2) s = parts.join('');
    else if (parts[1] && parts[1].length === 3) s = parts.join('');
  }
  const n = parseFloat(s);
  return isNaN(n) ? NaN : n;
}

// Converte data (Date do Excel, "DD/MM/AAAA" ou "AAAA-MM-DD") pro formato ISO.
// Confere se ano/mês/dia formam uma data que existe de verdade no calendário
// (rejeita 31/02, dia 32, mês 13...) — sem isso, uma data digitada errada
// derruba o lote de importação inteiro no banco, não só aquela linha.
function dataCalendarioValida(ano, mes, dia) {
  const d = new Date(ano, mes - 1, dia);
  return d.getFullYear() === ano && d.getMonth() === mes - 1 && d.getDate() === dia;
}

function parseVencimentoBR(raw) {
  if (raw instanceof Date && !isNaN(raw)) {
    return `${raw.getFullYear()}-${String(raw.getMonth()+1).padStart(2,'0')}-${String(raw.getDate()).padStart(2,'0')}`;
  }
  const s = String(raw ?? '').trim();
  const br = s.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);
  if (br) {
    const dia = parseInt(br[1], 10), mes = parseInt(br[2], 10), ano = parseInt(br[3], 10);
    if (!dataCalendarioValida(ano, mes, dia)) return '';
    return `${ano}-${String(mes).padStart(2,'0')}-${String(dia).padStart(2,'0')}`;
  }
  const iso = s.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (iso) {
    const ano = parseInt(iso[1], 10), mes = parseInt(iso[2], 10), dia = parseInt(iso[3], 10);
    if (!dataCalendarioValida(ano, mes, dia)) return '';
    return s;
  }
  return '';
}

function normalizeHeader(h) { return String(h ?? '').trim().toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, ''); }

function showImportError(msg) { const el = document.getElementById('import-error'); el.textContent = msg; el.style.display = 'block'; }
function hideImportError() { document.getElementById('import-error').style.display = 'none'; }

// Acha a linha de cabeçalho mesmo se houver uma linha de instruções acima
// (como no modelo baixável, que tem um aviso na linha 1 e os cabeçalhos na 2).
// Devolve -1 se não achar nenhuma linha parecida com cabeçalho.
function procurarCabecalho(rows) {
  const marcas = { tipo: ['tipo'], valor: ['valor'], descricao: ['descricao','descrição','desc'] };
  for (let i = 0; i < Math.min(rows.length, 10); i++) {
    const norm = (rows[i] || []).map(normalizeHeader);
    const achou = k => norm.some(h => marcas[k].some(a => h.startsWith(a)));
    if (achou('tipo') && achou('valor') && achou('descricao')) return i;
  }
  return -1;
}
function encontrarLinhaCabecalho(rows) {
  const i = procurarCabecalho(rows);
  return i < 0 ? 0 : i;
}

// Planilhas às vezes têm mais de uma aba (ex: uma aba de notas antes da aba
// de verdade). Usa a primeira aba que tiver uma linha de cabeçalho reconhecível
// em vez de sempre assumir que é a primeira da lista.
function linhasDaAbaCerta(workbook) {
  let candidata = null;
  for (const nome of workbook.SheetNames) {
    const rows = XLSX.utils.sheet_to_json(workbook.Sheets[nome], { header: 1, raw: true, defval: '' });
    if (!candidata) candidata = rows;
    if (procurarCabecalho(rows) >= 0) return rows;
  }
  return candidata || [];
}

function processRows(rows) {
  if (!rows || rows.length < 2) { showImportError('Não encontrei nenhuma linha preenchida nessa planilha.'); return; }
  const headerRowIdx = encontrarLinhaCabecalho(rows);
  const headers = (rows[headerRowIdx] || []).map(normalizeHeader);
  const col = k => {
    const alts = {
      tipo: ['tipo'], descricao: ['descricao','descrição','desc'], valor: ['valor'],
      vencimento: ['vencimento','data'], categoria: ['categoria'],
      toc: ['fixo','custo','classificacao'],
      contraparte: ['cliente','fornecedor','contraparte'], telefone: ['telefone','whatsapp','celular'],
    };
    for (const a of (alts[k] || [k])) { const i = headers.findIndex(h => h.startsWith(a)); if (i >= 0) return i; }
    return -1;
  };
  const ci = { tipo: col('tipo'), desc: col('descricao'), valor: col('valor'), venc: col('vencimento'), cat: col('categoria'), toc: col('toc'), cp: col('contraparte'), tel: col('telefone') };
  if (ci.tipo < 0 || ci.desc < 0 || ci.valor < 0 || ci.venc < 0) {
    showImportError('Não encontrei as colunas Tipo, Descrição, Valor e Vencimento nessa planilha. Baixe o modelo (passo 1) pra ver o formato certo.');
    return;
  }

  const tipoAlts = { pagar: ['pagar','despesa','saida','saída'], receber: ['receber','receita','entrada'] };
  const normTipo = v => {
    const s = normalizeHeader(v);
    for (const t of Object.keys(tipoAlts)) if (tipoAlts[t].some(a => s.startsWith(a))) return t;
    return '';
  };

  pendingImport = [];
  const linhasComProblema = [];
  for (let i = headerRowIdx + 1; i < rows.length; i++) {
    const c = rows[i];
    if (!c || c.every(v => String(v ?? '').trim() === '')) continue;
    const tipo = normTipo(c[ci.tipo]);
    const desc = String(c[ci.desc] ?? '').trim();
    const valor = parseValorBR(c[ci.valor]);
    const venc = parseVencimentoBR(c[ci.venc]);
    const cat = ci.cat >= 0 ? String(c[ci.cat] ?? '').trim() : '';
    const contraparte = ci.cp >= 0 ? String(c[ci.cp] ?? '').trim() : '';
    const telefone = ci.tel >= 0 ? String(c[ci.tel] ?? '').trim() : '';
    let toc = ci.toc >= 0 ? normalizeHeader(c[ci.toc] || 'fixo') : 'fixo';
    toc = toc.startsWith('vari') ? 'ctv' : 'do';
    if (!tipo || !desc || !valor || isNaN(valor) || !venc) {
      // Linha do checklist que a pessoa não usou (Valor e Vencimento os dois em
      // branco) não é erro, é o esperado — só avisa quando ela começou a
      // preencher um dos dois e não terminou o outro (aí sim pode ser descuido).
      const valorDigitado = String(c[ci.valor] ?? '').trim() !== '';
      const vencDigitado = String(c[ci.venc] ?? '').trim() !== '';
      if (valorDigitado || vencDigitado) linhasComProblema.push(i + 1);
      continue;
    }
    pendingImport.push({ id: uid(), tipo, descricao: desc, valor, vencimento: venc, categoria: cat, contraparte: contraparte || null, contraparte_telefone: telefone || null, status: 'pendente', recorrencia: 'none', toc, origem: 'importado' });
  }

  if (!pendingImport.length) {
    showImportError('Nenhuma linha ficou completa. Confira se Tipo, Descrição, Valor e Vencimento estão preenchidos em cada conta.');
    return;
  }
  document.getElementById('import-result').style.display = 'block';
  let msg = `${pendingImport.length} conta(s) prontas pra importar. Revise e confirme:`;
  if (linhasComProblema.length) {
    const plural = linhasComProblema.length > 1;
    msg += ` (falta valor ou data na${plural?'s':''} linha${plural?'s':''} ${linhasComProblema.join(', ')} — confira se quiser incluir ${plural?'elas':'ela'} também)`;
  }
  document.getElementById('import-msg').textContent = msg;
  const tbl = document.getElementById('import-preview');
  tbl.querySelector('thead').innerHTML = '<tr><th>Tipo</th><th>Descrição</th><th>Vencimento</th><th>Valor</th><th>Custo</th></tr>';
  tbl.querySelector('tbody').innerHTML = pendingImport.slice(0, 20).map(r =>
    `<tr><td><span class="badge ${escapeHtml(r.tipo)}">${escapeHtml(r.tipo)}</span></td><td>${escapeHtml(r.descricao)}</td><td>${fmtDate(r.vencimento)}</td><td>${fmt(r.valor)}</td><td><span class="badge ${r.toc}">${r.toc==='ctv'?'VARIÁVEL':'FIXO'}</span></td></tr>`
  ).join('') + (pendingImport.length > 20 ? `<tr><td colspan="5" class="empty">...e mais ${pendingImport.length-20} registros</td></tr>` : '');
}

async function confirmImport() {
  const toInsert = pendingImport.map(({ id: _ignore, ...rest }) => ({ ...rest, subscriber_id: currentUser.id }));
  const { data: rows, error } = await sb.from('lancamentos').insert(toInsert).select();
  if (!error) {
    data.push(...(rows || []));
    showSync(`${rows.length} lançamentos importados ✓`);
    cancelImport(); pendingImport = [];
    renderTable(); refreshAll();
    return;
  }
  // O lote inteiro é gravado de uma vez só — se uma linha tiver um valor que o
  // banco rejeita, todas as outras (mesmo as corretas) cairiam junto. Tenta de
  // novo uma por uma pra salvar o que der certo em vez de perder tudo.
  let sucesso = 0, falhas = 0;
  for (const item of toInsert) {
    const { data: row, error: err } = await sb.from('lancamentos').insert(item).select().single();
    if (err) { falhas++; continue; }
    data.push(row); sucesso++;
  }
  if (sucesso > 0) {
    showSync(`${sucesso} lançamento(s) importado(s) ✓${falhas ? ` — ${falhas} não entraram, confira os valores dessas linhas` : ''}`, falhas > 0);
  } else {
    showSync('Erro ao importar ✗', true);
  }
  cancelImport(); pendingImport = [];
  renderTable(); refreshAll();
}
function cancelImport() { document.getElementById('import-result').style.display='none'; document.getElementById('file-input').value=''; hideImportError(); }

async function downloadTemplate() {
  const btn = document.getElementById('btn-template');
  const textoOriginal = btn.textContent;
  btn.disabled = true; btn.textContent = 'Gerando planilha...';
  try {
    const AZUL = '2563EB', AZUL_CLARO = 'DBEAFE', AMBAR = 'FEF3C7', AMBAR_TEXTO = '92400E', BORDA = 'D1D5DB', FUNDO_EXEMPLO = 'F3F4F6';
    const borda = { style: 'thin', color: BORDA };
    const bordaCompleta = { top: borda, bottom: borda, left: borda, right: borda };

    // Poucos estilos, reaproveitados em várias células — em vez de um objeto
    // novo por célula, o que costuma inflar a tabela de estilos do xlsx e é a
    // causa mais comum de arquivo vindo "quebrado" (Excel/Numbers descartam
    // o que não conseguem ler ao reparar o arquivo).
    const estiloBanner = { bold: true, fill: AMBAR, fontColor: AMBAR_TEXTO, wrapText: true, verticalAlignment: 'center', border: bordaCompleta };
    const estiloCabecalhoObrigatorio = { bold: true, fill: AZUL, fontColor: 'FFFFFF', wrapText: true, verticalAlignment: 'center', horizontalAlignment: 'center', border: bordaCompleta };
    const estiloCabecalhoOpcional = { bold: true, fill: AZUL_CLARO, fontColor: '1E3A8A', wrapText: true, verticalAlignment: 'center', horizontalAlignment: 'center', border: bordaCompleta };
    const estiloExemplo = { italic: true, fontColor: '6B7280', fill: FUNDO_EXEMPLO, wrapText: true, verticalAlignment: 'center', border: bordaCompleta };
    const estiloTexto = { verticalAlignment: 'center', border: bordaCompleta };
    const estiloTextoQuebra = { verticalAlignment: 'center', border: bordaCompleta, wrapText: true };
    const estiloMoeda = { verticalAlignment: 'center', border: bordaCompleta, numberFormat: '#,##0.00' };
    const estiloData = { verticalAlignment: 'center', border: bordaCompleta, numberFormat: 'dd/mm/yyyy' };

    const workbook = await XlsxPopulate.fromBlankAsync();
    const sheet = workbook.sheet(0);
    sheet.name('Contas');

    const headers = ['Tipo *', 'Descrição *', 'Valor (R$) *', 'Vencimento *', 'Categoria', 'Cliente ou Fornecedor', 'Fixo ou Variável'];
    const nCols = headers.length;
    const ultimaLinha = 48;

    // Linha 1 — instruções
    sheet.range(1, 1, 1, nCols).merged(true);
    sheet.cell('A1')
      .value('Já deixamos as despesas mais comuns de loja preenchidas — você só precisa colocar o Valor e o Vencimento de cada uma que você tem. Não usa uma dessas contas? Deixe o Valor em branco que ela não entra. Quer adicionar outra? Use uma linha em branco lá embaixo. A linha 3 é só um exemplo de como fica uma linha completa.')
      .style(estiloBanner);
    sheet.row(1).height(48);

    // Linha 2 — cabeçalho
    headers.forEach((h, i) => {
      const obrigatorio = h.includes('*');
      sheet.cell(2, i + 1).value(h).style(obrigatorio ? estiloCabecalhoObrigatorio : estiloCabecalhoOpcional);
    });
    sheet.row(2).height(30);

    // Linha 3 — um exemplo completo (já com valor e data), só pra mostrar o formato
    const exemplo = ['Receber', 'Venda de produtos (EXEMPLO — isto aqui é só ilustrativo)', 1500, new Date(2026, 8, 5), 'Vendas', 'João da Silva Materiais', ''];
    exemplo.forEach((v, c) => {
      sheet.cell(3, c + 1).value(v).style(estiloExemplo);
    });
    sheet.cell(3, 3).style('numberFormat', '#,##0.00');
    sheet.cell(3, 4).style('numberFormat', 'dd/mm/yyyy');
    sheet.row(3).height(30);

    // Linhas 4+ — checklist com as despesas mais comuns de uma loja de rua já
    // descritas (inclusive as taxas financeiras, explicadas em linguagem simples).
    // Tipo, Descrição, Categoria e Fixo/Variável já vêm prontos; só falta
    // Valor e Vencimento de cada uma que a pessoa realmente tem.
    const checklist = [
      ['Pagar', 'Aluguel da loja', 'Aluguel', 'Fixo'],
      ['Pagar', 'Água (conta de água)', 'Contas de consumo', 'Fixo'],
      ['Pagar', 'Luz (conta de energia elétrica)', 'Contas de consumo', 'Fixo'],
      ['Pagar', 'Internet', 'Contas de consumo', 'Fixo'],
      ['Pagar', 'Telefone / celular da loja', 'Contas de consumo', 'Fixo'],
      ['Pagar', 'Tarifa da conta bancária (mensalidade que o banco cobra todo mês)', 'Despesas financeiras', 'Fixo'],
      ['Pagar', 'Contador (honorários contábeis)', 'Serviços', 'Fixo'],
      ['Pagar', 'Salário de funcionário', 'Folha de pagamento', 'Fixo'],
      ['Pagar', 'Pró-labore (retirada do dono/sócio)', 'Folha de pagamento', 'Fixo'],
      ['Pagar', 'Faxina / limpeza', 'Serviços', 'Fixo'],
      ['Pagar', 'Taxa da maquininha de cartão – débito (desconto que a operadora de cartão cobra em cima de cada venda no débito)', 'Despesas financeiras', 'Variável'],
      ['Pagar', 'Taxa da maquininha de cartão – crédito (desconto que a operadora de cartão cobra em cima de cada venda no crédito)', 'Despesas financeiras', 'Variável'],
      ['Receber', 'Vendas do dia (dinheiro ou Pix)', 'Vendas', ''],
      ['Receber', 'Vendas no cartão (a receber da operadora)', 'Vendas', ''],
    ];
    const primeiraLinhaChecklist = 4;
    checklist.forEach((item, i) => {
      const linha = primeiraLinhaChecklist + i;
      const [tipo, desc, categoria, toc] = item;
      sheet.cell(linha, 1).value(tipo).style(estiloTexto);
      sheet.cell(linha, 2).value(desc).style(estiloTextoQuebra);
      sheet.cell(linha, 3).style(estiloMoeda);
      sheet.cell(linha, 4).style(estiloData);
      sheet.cell(linha, 5).value(categoria).style(estiloTexto);
      sheet.cell(linha, 6).style(estiloTexto);
      sheet.cell(linha, 7).value(toc).style(estiloTexto);
      sheet.row(linha).height(desc.length > 60 ? 42 : 22);
    });

    // Seção de fornecedores — uma loja de varejo normalmente compra de vários
    // fornecedores diferentes, então em vez de uma linha genérica só, reserva
    // um bloco inteiro já com Tipo/Categoria/Fixo-Variável prontos; a pessoa
    // só digita o nome do fornecedor, o valor e a data de cada compra.
    const linhaTituloFornecedores = primeiraLinhaChecklist + checklist.length;
    sheet.range(linhaTituloFornecedores, 1, linhaTituloFornecedores, nCols).merged(true);
    sheet.cell(linhaTituloFornecedores, 1)
      .value('Compras de mercadoria — uma linha para cada fornecedor/compra (é normal ter vários)')
      .style(estiloCabecalhoOpcional);
    sheet.row(linhaTituloFornecedores).height(30);

    const primeiraLinhaFornecedores = linhaTituloFornecedores + 1;
    const totalLinhasFornecedores = 20;
    for (let i = 0; i < totalLinhasFornecedores; i++) {
      const linha = primeiraLinhaFornecedores + i;
      sheet.cell(linha, 1).value('Pagar').style(estiloTexto);
      sheet.cell(linha, 2).value('Compra de mercadoria').style(estiloTexto);
      sheet.cell(linha, 3).style(estiloMoeda);
      sheet.cell(linha, 4).style(estiloData);
      sheet.cell(linha, 5).value('Mercadoria').style(estiloTexto);
      sheet.cell(linha, 6).style(estiloTexto);
      sheet.cell(linha, 7).value('Variável').style(estiloTexto);
    }

    // Linhas seguintes — área em branco pra adicionar outras contas, já com
    // borda e formato de número/data prontos
    const primeiraLinhaLivre = primeiraLinhaFornecedores + totalLinhasFornecedores;
    for (let linha = primeiraLinhaLivre; linha <= ultimaLinha; linha++) {
      for (let c = 1; c <= nCols; c++) {
        sheet.cell(linha, c).style(c === 3 ? estiloMoeda : c === 4 ? estiloData : estiloTexto);
      }
    }

    const larguras = [12, 48, 14, 14, 18, 26, 16];
    larguras.forEach((w, i) => sheet.column(i + 1).width(w));

    // Dropdowns nas colunas Tipo, Categoria e Fixo/Variável — as opções de
    // categoria são as mesmas sugeridas no formulário de Lançamentos
    // (CATEGORIAS_PADRAO), somadas às que já aparecem no checklist acima,
    // pra ficar tudo consistente entre planilha e app. As listas moram numa
    // aba oculta em vez de embutidas na fórmula porque o Excel trunca listas
    // inline com mais de ~255 caracteres.
    const categoriasChecklist = checklist.map(item => item[2]);
    const listaTipo = ['Pagar', 'Receber'];
    const listaCategoria = [...new Set([...CATEGORIAS_PADRAO.pagar, ...CATEGORIAS_PADRAO.receber, ...categoriasChecklist, 'Mercadoria'])];
    const listaToc = ['Fixo', 'Variável'];

    const listasSheet = workbook.addSheet('Listas');
    listaCategoria.forEach((c, i) => listasSheet.cell(i + 1, 1).value(c));
    listaTipo.forEach((t, i) => listasSheet.cell(i + 1, 2).value(t));
    listaToc.forEach((t, i) => listasSheet.cell(i + 1, 3).value(t));
    listasSheet.hidden(true);

    // xlsx-populate grava qualquer propriedade não informada como o texto
    // literal "undefined" no XML — por isso todo campo opcional do objeto
    // de validação vai explícito aqui, mesmo repetindo o valor padrão.
    const validacaoEstrita = ref => ({
      type: 'list', allowBlank: true, formula1: ref, operator: 'between',
      showInputMessage: false, prompt: '', promptTitle: '',
      showErrorMessage: true, errorTitle: 'Valor inválido', error: 'Escolha um valor da listinha ao lado da célula.',
    });
    // Categoria é só sugestão, não uma lista fechada — o usuário pode digitar
    // o nome que quiser, então não bloqueia com mensagem de erro.
    const validacaoSugestao = ref => ({
      type: 'list', allowBlank: true, formula1: ref, operator: 'between',
      showInputMessage: false, prompt: '', promptTitle: '',
      showErrorMessage: false, errorTitle: '', error: '',
    });
    sheet.range(3, 1, ultimaLinha, 1).dataValidation(validacaoEstrita(`Listas!$B$1:$B$${listaTipo.length}`));
    sheet.range(3, 5, ultimaLinha, 5).dataValidation(validacaoSugestao(`Listas!$A$1:$A$${listaCategoria.length}`));
    sheet.range(3, 7, ultimaLinha, 7).dataValidation(validacaoEstrita(`Listas!$C$1:$C$${listaToc.length}`));

    const blob = await workbook.outputAsync();
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url; a.download = 'modelo-meuargus.xlsx'; a.click();
    setTimeout(() => URL.revokeObjectURL(url), 4000);
  } catch (err) {
    alert('Não consegui gerar a planilha modelo agora. Tenta de novo em alguns segundos.');
  } finally {
    btn.disabled = false; btn.textContent = textoOriginal;
  }
}
