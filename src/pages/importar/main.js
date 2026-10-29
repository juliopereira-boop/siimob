// ═════════════════════════════════════════════════════════════════════════════
// IMPORTADOR DE BASE
//
// A planilha do cliente traz, por linha, um processo inteiro: cliente, corretor,
// coordenador, agência, construtora, modalidade, cidade e a situação no
// workflow. Parte disso já existe cadastrado e só precisa ser ligado; parte
// ainda não existe e precisa ser criada.
//
// A regra que guia tudo aqui: NADA é gravado antes de a pessoa ver o que vai
// acontecer. A tela 3 mostra, valor por valor, se vai ligar num cadastro que já
// existe, criar um novo, ou se não deu para decidir. Divergência não vira
// palpite silencioso — vira aviso.
// ═════════════════════════════════════════════════════════════════════════════

import { A1 } from '../../shared/api/config.js';
import { esc } from '../../shared/utils/texto.js';
import { a1RefreshPartnerPerms, a1RequireAuth, a1StartHeartbeat } from '../../shared/auth/auth.js';
import { XLSX } from '../../shared/utils/xlsx-leve.js';
import { expor, exporVariavel } from '../../shared/utils/expor.js';
import { acoes } from '../../shared/ui/acoes.js';

// Alcançáveis pela suíte de testes e por sondas typeof. Ver src/shared/utils/expor.js.
expor({ conferir, escolheu, importar, passo });
exporVariavel('G', () => G);
exporVariavel('val', () => val);

// O que cada data-acao do HTML faz. Ver src/shared/ui/acoes.js.
acoes({
  conferir: () => conferir(),
  escolherCidade: el => {
    G.cidadeEscolha[el.dataset.cidade] = el.value;
  },
  escolherEtapa: el => {
    G.deEtapa[el.dataset.situacao] = el.value;
    resumoImport();
  },
  escolheu: el => escolheu(el.files[0]),
  importar: () => importar(),
  mapearColuna: el => {
    G.mapa[el.dataset.chave] = el.value;
  }
});
const G = {
  user: null,
  slug: null,
  linhas: [],
  colunas: [],
  mapa: {},
  analise: null,
  etapas: [],
  deEtapa: {}
};

// ── Comparação de nomes ──────────────────────────────────────────────────────
// Planilha e cadastro quase nunca escrevem igual: acento, caixa, espaço a mais.
function norm(s) {
  return String(s == null ? '' : s)
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toUpperCase()
    .replace(/\s+/g, ' ')
    .trim();
}
// "THYAGO FRANÇA" tem que achar "THYAGO DE FRANÇA BARBOSA": todas as palavras
// da versão curta aparecem na longa. Se mais de um cadastro servir, não escolhe
// sozinho — devolve ambíguo para a pessoa resolver.
function casar(valor, lista, campo = 'name') {
  const a = norm(valor);
  if (!a) return { tipo: 'vazio' };
  const exato = lista.filter(x => norm(x[campo]) === a);
  if (exato.length === 1) return { tipo: 'exato', item: exato[0] };
  if (exato.length > 1) return { tipo: 'ambiguo', itens: exato };
  const toks = new Set(a.split(' '));
  const parc = lista.filter(x => {
    const b = new Set(norm(x[campo]).split(' '));
    return [...toks].every(t => b.has(t));
  });
  if (parc.length === 1) return { tipo: 'parcial', item: parc[0] };
  if (parc.length > 1) return { tipo: 'ambiguo', itens: parc };
  return { tipo: 'nenhum' };
}

// ── Colunas que o importador entende ─────────────────────────────────────────
const CAMPOS = [
  { chave: 'data', rotulo: 'Data da venda', dicas: ['DATA', 'FECHAMENTO', 'VENDA'] },
  { chave: 'analista', rotulo: 'Analista', dicas: ['ANALISTA', 'OPERADOR'] },
  { chave: 'cidade', rotulo: 'Cidade', dicas: ['CIDADE', 'MUNICIPIO'] },
  { chave: 'construtora', rotulo: 'Construtora (Regional)', dicas: ['CONSTRUTORA', 'REGIONAL'] },
  { chave: 'modalidade', rotulo: 'Modalidade', dicas: ['MODALIDADE'] },
  { chave: 'corretor', rotulo: 'Corretor', dicas: ['CORRETOR'] },
  { chave: 'coordenador', rotulo: 'Coordenador', dicas: ['COORDENADOR'] },
  { chave: 'cliente', rotulo: 'Cliente', dicas: ['CLIENTE', 'PROPONENTE', 'NOME'] },
  { chave: 'cpf', rotulo: 'CPF do cliente', dicas: ['CPF'] },
  { chave: 'agencia', rotulo: 'Agência', dicas: ['AGENCIA', 'AG.', 'AG'] },
  { chave: 'status', rotulo: 'Situação', dicas: ['STATUS', 'SITUACAO', 'ETAPA'] }
];

// ═══ Início ══════════════════════════════════════════════════════════════════
(async function inicio() {
  // Importar mexe em cadastro e cria processo: é coisa de gestor.
  G.user = a1RequireAuth(['owner', 'admin']);
  G.slug = A1.slug;
  await a1RefreshPartnerPerms();
  document.getElementById('voltar').href = `/${G.slug}/configuracoes`;
  a1StartHeartbeat('configuracoes');

  const z = document.getElementById('zona');
  ['dragenter', 'dragover'].forEach(e =>
    z.addEventListener(e, ev => {
      ev.preventDefault();
      z.classList.add('sobre');
    })
  );
  ['dragleave', 'drop'].forEach(e =>
    z.addEventListener(e, ev => {
      ev.preventDefault();
      z.classList.remove('sobre');
    })
  );
  z.addEventListener('drop', ev => {
    const f = ev.dataTransfer.files[0];
    if (f) escolheu(f);
  });
})();

// ═══ 1. Ler o arquivo ════════════════════════════════════════════════════════
async function escolheu(arquivo) {
  if (!arquivo) return;
  const info = document.getElementById('arq-info');
  info.classList.remove('hidden');
  info.innerHTML = '<div class="spinner"></div>';
  try {
    const linhas = await XLSX.ler(arquivo);
    if (linhas.length < 2)
      throw new Error('A planilha tem menos de duas linhas — sem cabeçalho e dados não dá para importar.');
    G.cabecalho = linhas[0];
    G.linhas = linhas.slice(1).filter(l => Object.values(l).some(v => String(v).trim()));
    G.colunas = [...new Set(linhas.flatMap(l => Object.keys(l)))].sort(
      (a, b) => XLSX.colNum(a) - XLSX.colNum(b)
    );
    info.innerHTML = `<div class="aviso a-ok"><b>${esc(arquivo.name)}</b> — ${G.linhas.length} linha(s) de dados, ${G.colunas.length} coluna(s).</div>`;
    montarMapa();
  } catch (e) {
    info.innerHTML = `<div class="aviso a-erro">Não consegui ler: ${esc(e.message)}</div>`;
  }
}

// ═══ 2. Mapear colunas ═══════════════════════════════════════════════════════
function montarMapa() {
  // Palpite pelo cabeçalho; sempre editável.
  const palpite = {};
  for (const col of G.colunas) {
    const cab = norm(G.cabecalho[col]);
    if (!cab) continue;
    for (const c of CAMPOS) {
      if (palpite[c.chave]) continue;
      if (c.dicas.some(d => cab === d || cab.startsWith(d) || cab.includes(d))) {
        palpite[c.chave] = col;
        break;
      }
    }
  }
  G.mapa = palpite;
  document.getElementById('mapa').innerHTML = CAMPOS.map(
    c => `
    <div class="campo">
      <label>${esc(c.rotulo)}</label>
      <select id="map-${c.chave}" data-acao-change="mapearColuna" data-chave="${esc(c.chave)}">
        <option value="">— não tem na planilha —</option>
        ${G.colunas.map(col => `<option value="${esc(col)}"${palpite[c.chave] === col ? ' selected' : ''}>${esc(col)} · ${esc(G.cabecalho[col] || '(sem título)')}</option>`).join('')}
      </select>
    </div>`
  ).join('');
  const faltam = CAMPOS.filter(c => !palpite[c.chave]).map(c => c.rotulo);
  document.getElementById('mapa-obs').textContent = faltam.length
    ? 'Não reconheci: ' + faltam.join(', ') + '.'
    : 'Reconheci todas as colunas.';
  document.getElementById('p-colunas').classList.remove('hidden');
  document.getElementById('p-colunas').scrollIntoView({ behavior: 'smooth', block: 'nearest' });
}

const val = (linha, chave) => {
  const col = G.mapa[chave];
  return col ? String(linha[col] == null ? '' : linha[col]).trim() : '';
};
const distintos = chave =>
  [...new Set(G.linhas.map(l => val(l, chave)).filter(Boolean))].sort((a, b) => a.localeCompare(b, 'pt-BR'));

// ═══ 3. Conferir ═════════════════════════════════════════════════════════════
async function conferir() {
  const corpo = document.getElementById('conf-corpo');
  document.getElementById('p-conf').classList.remove('hidden');
  corpo.innerHTML = '<div class="spinner"></div>';
  document.getElementById('conf-resumo').innerHTML = '';

  const [analistas, corretores, coords, modalidades, agencias, etapas, cfg] = await Promise.all([
    buscar(`a1_partners?type=eq.analista&select=id,name,is_active`),
    buscar(`a1_partners?type=eq.corretor&select=id,name,is_active,extra`),
    buscar(`a1_partners?type=eq.coordenador&select=id,name,is_active`),
    buscar(`a1_partners?type=eq.modalidade&select=id,name,is_active`),
    buscar(`a1_partners?type=eq.agencia&select=id,name,is_active,extra`),
    buscar(`a1_stages?module_key=eq.repasse&select=id,name,position,is_initial&order=position.asc`),
    buscar(`a1_config?key=eq.regionais&select=value`)
  ]);
  let regionais = [];
  try {
    regionais = JSON.parse((cfg[0] && cfg[0].value) || '[]');
  } catch {}
  if (!Array.isArray(regionais)) regionais = [];

  G.etapas = Array.isArray(etapas) ? etapas : [];
  G.existente = { analistas, corretores, coords, modalidades, agencias, regionais };

  // Cidades: descobre a UF consultando a base do IBGE. Nome parcial na planilha
  // ("DEMERVAL" para "Demerval Lobão") é resolvido por começo do nome.
  const cidades = distintos('cidade');
  G.cidadeUF = {};
  await Promise.all(
    cidades.map(async nome => {
      const achados = await buscar(
        `a1_municipios?select=nome,uf&nome=ilike.${encodeURIComponent(nome)}*&limit=20`
      );
      G.cidadeUF[nome] = Array.isArray(achados) ? achados : [];
    })
  );

  const blocos = [];
  const alertas = [];

  // ── Analista: só liga, nunca cria ──────────────────────────────────────────
  blocos.push(
    secao(
      'Analista',
      'Liga ao cadastro que já existe. Não cria analista — quem cria é você, em Configurações.',
      distintos('analista').map(v => {
        const r = casar(
          v,
          analistas.filter(a => a.is_active !== false)
        );
        if (r.tipo === 'exato') return linhaConf(v, 'liga', 'liga a ' + r.item.name);
        if (r.tipo === 'parcial')
          return linhaConf(v, 'liga', 'liga a ' + r.item.name, 'nome diferente na planilha — confira');
        if (r.tipo === 'ambiguo') {
          alertas.push(`Analista "${v}" combina com mais de um cadastro.`);
          return linhaConf(v, 'erro', 'mais de um cadastro combina', r.itens.map(i => i.name).join(' / '));
        }
        alertas.push(`Analista "${v}" não tem cadastro. Os processos dele entram sem analista.`);
        return linhaConf(v, 'erro', 'sem cadastro', 'processo entra sem analista');
      })
    )
  );

  // ── Construtora → Regional: só liga ───────────────────────────────────────
  blocos.push(
    secao(
      'Construtora (Regional)',
      'Liga às regionais já cadastradas. Não cria regional.',
      distintos('construtora').map(v => {
        const r = casar(
          v,
          regionais.map(n => ({ name: n }))
        );
        if (r.tipo === 'exato' || r.tipo === 'parcial') return linhaConf(v, 'liga', 'liga a ' + r.item.name);
        alertas.push(`Construtora "${v}" não está nas Regionais. Os processos dela entram sem regional.`);
        return linhaConf(v, 'erro', 'não está nas Regionais', 'processo entra sem regional');
      })
    )
  );

  // ── Cidade → Estado ────────────────────────────────────────────────────────
  blocos.push(
    secao(
      'Cidade e Estado',
      'O estado vem da base do IBGE a partir do nome da cidade.',
      cidades.map(v => {
        const op = G.cidadeUF[v] || [];
        const exato = op.filter(m => norm(m.nome) === norm(v));
        const usar = exato.length ? exato : op;
        if (usar.length === 1) return linhaConf(v, 'liga', `${usar[0].nome} / ${usar[0].uf}`);
        if (usar.length > 1) {
          return linhaConf(
            v,
            'alerta',
            'mais de uma cidade com esse nome',
            `<select data-acao-change="escolherCidade" data-cidade="${esc(v)}">
             ${usar.map(m => `<option value="${esc(m.nome)}|${esc(m.uf)}">${esc(m.nome)} / ${esc(m.uf)}</option>`).join('')}
           </select>`,
            true
          );
        }
        alertas.push(
          `Cidade "${v}" não foi encontrada na base do IBGE. O processo entra sem cidade e sem estado.`
        );
        return linhaConf(v, 'erro', 'não encontrada no IBGE', 'entra sem cidade/estado');
      })
    )
  );
  G.cidadeEscolha = {};
  for (const v of cidades) {
    const op = G.cidadeUF[v] || [];
    const ex = op.filter(m => norm(m.nome) === norm(v));
    const usar = ex.length ? ex : op;
    if (usar.length) G.cidadeEscolha[v] = `${usar[0].nome}|${usar[0].uf}`;
  }

  // ── Modalidade / Corretor / Coordenador / Agência: liga ou cria ───────────
  blocos.push(secaoCriavel('Modalidade', modalidades, distintos('modalidade')));
  blocos.push(
    secaoCriavel(
      'Corretor',
      corretores,
      distintos('corretor'),
      'Entra só com o nome. Para virar login, complete o cadastro depois em Configurações → Corretores.'
    )
  );
  blocos.push(secaoCriavel('Coordenador', coords, distintos('coordenador')));

  // Agência vem como "0855 - JOQUEI": número e nome no mesmo campo.
  const ags = distintos('agencia').map(v => ({ bruto: v, ...partirAgencia(v) }));
  blocos.push(
    secao(
      'Agência',
      'O número e o nome são separados automaticamente.',
      ags.map(a => {
        const r = casar(a.nome, agencias);
        const numIgual = agencias.find(x => String((x.extra && x.extra.numero) || '') === a.numero);
        const jaTem = r.tipo === 'exato' || r.tipo === 'parcial' ? r.item : numIgual;
        return jaTem
          ? linhaConf(a.bruto, 'liga', `liga a ${jaTem.name}`, `nº ${a.numero}`)
          : linhaConf(
              a.bruto,
              'cria',
              'cria',
              `número <b>${esc(a.numero || '—')}</b>, nome <b>${esc(a.nome)}</b>`,
              true
            );
      })
    )
  );
  G.agencias = ags;

  // ── Corretor com dois coordenadores ───────────────────────────────────────
  const porCorretor = {};
  for (const l of G.linhas) {
    const c = norm(val(l, 'corretor')),
      k = val(l, 'coordenador');
    if (!c || !k) continue;
    (porCorretor[c] = porCorretor[c] || new Set()).add(norm(k));
  }
  const conflitos = Object.entries(porCorretor).filter(([, s]) => s.size > 1);
  if (conflitos.length) {
    conflitos.forEach(([c, s]) =>
      alertas.push(
        `Corretor "${c}" aparece com ${s.size} coordenadores diferentes (${[...s].join(', ')}). Vou usar o da primeira linha; ajuste depois se precisar.`
      )
    );
  }

  // ── Nomes de corretor quase iguais ────────────────────────────────────────
  const nomesCor = distintos('corretor');
  for (let i = 0; i < nomesCor.length; i++)
    for (let j = i + 1; j < nomesCor.length; j++) {
      const a = norm(nomesCor[i]),
        b = norm(nomesCor[j]);
      if (a !== b && a.replace(/[ZS]/g, 'S') === b.replace(/[ZS]/g, 'S'))
        alertas.push(
          `"${nomesCor[i]}" e "${nomesCor[j]}" parecem a mesma pessoa escrita de dois jeitos. Vão entrar como dois corretores.`
        );
    }

  // ── Linhas sem data / sem cliente / sem CPF ───────────────────────────────
  const semData = G.linhas.filter(l => !dataISO(val(l, 'data'))).length;
  const semNome = G.linhas.filter(l => !val(l, 'cliente')).length;
  if (semData)
    alertas.push(
      `${semData} linha(s) sem data de venda válida. Entram sem data — e ficam de fora da visão de tempo por etapa.`
    );
  if (semNome) alertas.push(`${semNome} linha(s) sem nome de cliente. Essas NÃO serão importadas.`);

  corpo.innerHTML = blocos.join('');
  document.getElementById('conf-resumo').innerHTML = alertas.length
    ? `<div class="aviso a-alerta"><b>Confira antes de seguir:</b><ul style="margin:.4rem 0 0 1.1rem">${alertas.map(a => `<li>${esc(a)}</li>`).join('')}</ul></div>`
    : `<div class="aviso a-ok">Nenhuma divergência encontrada.</div>`;

  montarEtapas();
}

function secao(titulo, explica, linhas) {
  return `<div style="margin-bottom:1.3rem">
    <div style="font-size:.85rem;font-weight:800;margin-bottom:.15rem">${esc(titulo)}</div>
    <div class="sub" style="margin-bottom:.5rem">${explica}</div>
    <div class="rolagem"><table><thead><tr><th style="width:34%">Na planilha</th><th style="width:16%">Ação</th><th>Detalhe</th></tr></thead>
    <tbody>${linhas.join('') || '<tr><td colspan="3" style="color:var(--t3)">Nada nesta coluna.</td></tr>'}</tbody></table></div>
  </div>`;
}
function secaoCriavel(titulo, existentes, valores, explica) {
  return secao(
    titulo,
    explica || 'Liga ao que já existe; cria só o que faltar.',
    valores.map(v => {
      const r = casar(v, existentes);
      if (r.tipo === 'exato') return linhaConf(v, 'liga', 'liga a ' + r.item.name);
      if (r.tipo === 'parcial') return linhaConf(v, 'liga', 'liga a ' + r.item.name, 'nome parecido');
      if (r.tipo === 'ambiguo')
        return linhaConf(
          v,
          'alerta',
          'mais de um combina',
          r.itens.map(i => i.name).join(' / ') + ' — vou usar o primeiro'
        );
      return linhaConf(v, 'cria', 'cria');
    })
  );
}
function linhaConf(valor, tipo, acao, detalhe, cru) {
  const cls = { liga: 'm-liga', cria: 'm-cria', alerta: 'm-alerta', erro: 'm-erro' }[tipo] || 'm-neutro';
  return `<tr><td><b>${esc(valor)}</b></td>
    <td><span class="marca ${cls}">${esc(acao)}</span></td>
    <td style="color:var(--t2)">${cru ? detalhe : detalhe ? esc(detalhe) : ''}</td></tr>`;
}

function partirAgencia(v) {
  const m = String(v).match(/^\s*(\d+)\s*[-–—]\s*(.+)$/);
  if (m) return { numero: m[1].trim(), nome: m[2].trim() };
  const m2 = String(v).match(/^\s*(\d+)\s*$/);
  if (m2) return { numero: m2[1], nome: 'Agência ' + m2[1] };
  return { numero: '', nome: String(v).trim() };
}

function dataISO(v) {
  if (!v) return '';
  const s = String(v).trim();
  if (/^\d{4}-\d{2}-\d{2}$/.test(s)) return s;
  const br = s.match(/^(\d{1,2})[\/.-](\d{1,2})[\/.-](\d{2,4})$/);
  if (br) {
    const a = br[3].length === 2 ? '20' + br[3] : br[3];
    return `${a}-${br[2].padStart(2, '0')}-${br[1].padStart(2, '0')}`;
  }
  if (/^\d+$/.test(s)) {
    const d = XLSX.serialParaData(parseInt(s, 10));
    if (d) return d;
  }
  return '';
}

// ═══ 4. Situação → etapa ═════════════════════════════════════════════════════
function montarEtapas() {
  const cont = {};
  for (const l of G.linhas) {
    const s = val(l, 'status') || '(sem situação)';
    cont[s] = (cont[s] || 0) + 1;
  }
  const inicial = G.etapas.find(e => e.is_initial) || G.etapas[0];
  G.deEtapa = {};
  const linhas = Object.entries(cont)
    .sort((a, b) => b[1] - a[1])
    .map(([sit, n]) => {
      const r = casar(sit, G.etapas);
      const escolhida = r.tipo === 'exato' || r.tipo === 'parcial' ? r.item : null;
      G.deEtapa[sit] = escolhida ? escolhida.id : inicial ? inicial.id : '';
      return `<tr>
      <td><b>${esc(sit)}</b>${escolhida ? '' : ' <span class="marca m-alerta">sem etapa igual</span>'}</td>
      <td class="mono">${n}</td>
      <td><select data-acao-change="escolherEtapa" data-situacao="${esc(sit)}">
        ${G.etapas.map(e => `<option value="${esc(e.id)}"${G.deEtapa[sit] === e.id ? ' selected' : ''}>${esc(e.name)}</option>`).join('')}
        <option value="">— Não importar estas linhas —</option>
      </select></td></tr>`;
    });
  document.getElementById('tb-etapas').innerHTML = linhas.join('');
  document.getElementById('p-etapas').classList.remove('hidden');
  document.getElementById('p-importar').classList.remove('hidden');
  resumoImport();
}

function resumoImport() {
  const total = G.linhas.filter(
    l => val(l, 'cliente') && G.deEtapa[val(l, 'status') || '(sem situação)']
  ).length;
  const fora = G.linhas.length - total;
  document.getElementById('imp-resumo').innerHTML =
    `Vou criar <b>${total}</b> processo(s) no pipeline` +
    (fora ? `, deixando <b>${fora}</b> linha(s) de fora (sem cliente ou marcadas como não importar)` : '') +
    `, mais os cadastros que faltarem.`;
}

// ═══ 5. Importar ═════════════════════════════════════════════════════════════
let LOG = [];
function reg(msg, cls) {
  LOG.push(`<div class="${cls || ''}">${msg}</div>`);
  const el = document.getElementById('reg');
  el.innerHTML = LOG.join('');
  el.scrollTop = el.scrollHeight;
}
function passo(txt, pct) {
  document.getElementById('imp-passo').textContent = txt;
  document.getElementById('barra').style.width = Math.round(pct) + '%';
}

// Leitura simples: devolve sempre uma lista, mesmo quando dá erro, para uma
// tabela que não existe não derrubar a conferência inteira.
async function buscar(caminho) {
  try {
    const r = await fetch(A1.rest(caminho), { headers: A1.headers() });
    const j = await r.json();
    return Array.isArray(j) ? j : [];
  } catch {
    return [];
  }
}
async function criar(tabela, corpo) {
  const r = await fetch(A1.rest(tabela), {
    method: 'POST',
    headers: A1.returnHeaders(),
    body: JSON.stringify(corpo)
  });
  if (!r.ok) {
    const e = await r.json().catch(() => ({}));
    throw new Error(e.message || 'HTTP ' + r.status);
  }
  const j = await r.json().catch(() => []);
  return Array.isArray(j) ? j[0] : j;
}

async function importar() {
  const btn = document.getElementById('btn-importar');
  btn.disabled = true;
  document.getElementById('imp-durante').classList.remove('hidden');
  LOG = [];
  const t = G.user.tenant_id;

  try {
    // ── cadastros que faltam ─────────────────────────────────────────────────
    passo('Criando os cadastros que faltavam...', 5);
    const mapaSimples = {};
    for (const [tipo, chave, lista] of [
      ['modalidade', 'modalidade', G.existente.modalidades],
      ['corretor', 'corretor', G.existente.corretores],
      ['coordenador', 'coordenador', G.existente.coords]
    ]) {
      mapaSimples[tipo] = {};
      for (const v of distintos(chave)) {
        const r = casar(v, lista);
        if (r.tipo === 'exato' || r.tipo === 'parcial' || r.tipo === 'ambiguo') {
          mapaSimples[tipo][norm(v)] = (r.item || r.itens[0]).id;
          continue;
        }
        try {
          const novo = await criar('a1_partners', {
            tenant_id: t,
            type: tipo,
            name: v.trim(),
            is_active: true,
            approved: true,
            permissions: {},
            extra: { origem: 'importacao' }
          });
          mapaSimples[tipo][norm(v)] = novo.id;
          reg(`+ ${tipo}: ${esc(v)}`, 'ok');
        } catch (e) {
          reg(`! ${tipo} "${esc(v)}": ${esc(e.message)}`, 'er');
        }
      }
    }

    // agências
    passo('Criando as agências...', 18);
    const mapaAg = {};
    for (const a of G.agencias) {
      const r = casar(a.nome, G.existente.agencias);
      const porNum = G.existente.agencias.find(x => String((x.extra && x.extra.numero) || '') === a.numero);
      const ja = r.tipo === 'exato' || r.tipo === 'parcial' ? r.item : porNum;
      if (ja) {
        mapaAg[a.bruto] = ja;
        continue;
      }
      try {
        const novo = await criar('a1_partners', {
          tenant_id: t,
          type: 'agencia',
          name: a.nome,
          is_active: true,
          approved: true,
          extra: { numero: a.numero, origem: 'importacao' }
        });
        mapaAg[a.bruto] = novo;
        reg(`+ agência: ${esc(a.numero)} — ${esc(a.nome)}`, 'ok');
      } catch (e) {
        reg(`! agência "${esc(a.bruto)}": ${esc(e.message)}`, 'er');
      }
    }

    // ── coordenador de cada corretor ─────────────────────────────────────────
    passo('Ligando corretor e coordenador...', 30);
    const jaLigado = new Set();
    for (const l of G.linhas) {
      const nc = norm(val(l, 'corretor')),
        nk = norm(val(l, 'coordenador'));
      if (!nc || !nk || jaLigado.has(nc)) continue;
      jaLigado.add(nc);
      const idCor = mapaSimples.corretor[nc],
        idCoord = mapaSimples.coordenador[nk];
      if (!idCor || !idCoord) continue;
      const atual = G.existente.corretores.find(x => x.id === idCor);
      if (atual && atual.extra && atual.extra.coordenador_id) continue; // já tem, não sobrescreve
      try {
        await fetch(`${A1.rest('a1_partners')}?id=eq.${idCor}`, {
          method: 'PATCH',
          headers: A1.headers(),
          body: JSON.stringify({ extra: { ...((atual && atual.extra) || {}), coordenador_id: idCoord } })
        });
      } catch {}
    }

    // ── processos ────────────────────────────────────────────────────────────
    const aCriar = G.linhas.filter(l => val(l, 'cliente') && G.deEtapa[val(l, 'status') || '(sem situação)']);
    let feitos = 0,
      erros = 0;
    for (const l of aCriar) {
      const sit = val(l, 'status') || '(sem situação)';
      const etapaId = G.deEtapa[sit];
      const etapa = G.etapas.find(e => e.id === etapaId);

      const rAn = casar(
        val(l, 'analista'),
        G.existente.analistas.filter(a => a.is_active !== false)
      );
      const analistaNome = rAn.tipo === 'exato' || rAn.tipo === 'parcial' ? rAn.item.name : '';

      const rReg = casar(
        val(l, 'construtora'),
        G.existente.regionais.map(n => ({ name: n }))
      );
      const regional = rReg.tipo === 'exato' || rReg.tipo === 'parcial' ? rReg.item.name : '';

      const esc2 = (G.cidadeEscolha[val(l, 'cidade')] || '').split('|');
      const ag = mapaAg[val(l, 'agencia')];
      const agRot = ag ? (ag.extra && ag.extra.numero ? ag.extra.numero + ' - ' : '') + ag.name : '';

      const corpo = {
        tenant_id: t,
        module_key: 'repasse',
        client_name: val(l, 'cliente'),
        client_cpf: val(l, 'cpf').replace(/\D/g, ''),
        development: '',
        manager_name: analistaNome,
        broker_name: val(l, 'corretor'),
        stage_id: etapaId || null,
        stage_name: etapa ? etapa.name : null,
        is_new: false,
        payload: {
          regional,
          agencia: agRot,
          modalidade: val(l, 'modalidade'),
          data_venda: dataISO(val(l, 'data')),
          cidade: esc2[0] || '',
          estado: esc2[1] || '',
          origem: 'importacao',
          situacao_planilha: sit
        }
      };
      try {
        await criar('a1_cases', corpo);
        feitos++;
        reg(`+ ${esc(corpo.client_name)} → ${esc(corpo.stage_name || '')}`, 'ok');
      } catch (e) {
        erros++;
        reg(`! ${esc(corpo.client_name)}: ${esc(e.message)}`, 'er');
      }
      passo(
        `Criando processos... ${feitos + erros} de ${aCriar.length}`,
        30 + ((feitos + erros) / aCriar.length) * 70
      );
    }

    passo('Concluído.', 100);
    reg(
      `\n<b>${feitos} processo(s) criado(s)${erros ? `, ${erros} com erro` : ''}.</b>`,
      erros ? 'av' : 'ok'
    );
    document.getElementById('imp-antes').innerHTML =
      `<div class="aviso ${erros ? 'a-alerta' : 'a-ok'}">Importação concluída: <b>${feitos}</b> processo(s) no pipeline${erros ? `, <b>${erros}</b> com erro (veja o registro abaixo)` : ''}.
       <a href="/${esc(G.slug)}/andamento" style="color:inherit;font-weight:700">Abrir o pipeline →</a></div>`;
  } catch (e) {
    reg(`! Parou: ${esc(e.message)}`, 'er');
    btn.disabled = false;
  }
}
