// ─── Locação: documentos (contrato e termo de entrega de chaves) ─────────────
//
// O PEDIDO DO DONO
//   "Geração de contrato mesmo na aba contratos, o documento". Escolha: modelo
//   padrão do sistema + modelo editável por cliente.
//
// COMO FUNCIONA
//   - Cada tipo (contrato residencial, contrato comercial, termo de entrega de
//     chaves) tem um modelo padrão aqui. O cliente pode trocar o texto em
//     "Modelos" (tabela a1_lc_modelos); sem linha, vale o padrão.
//   - O modelo é texto com marcações simples: "# " título, "## " seção, linha
//     em branco separa parágrafos e {{campo}} é trocado pelo dado do contrato.
//   - O texto INTEIRO (modelo e dados) passa por esc() antes de virar HTML: o
//     modelo é digitado pelo cliente e não pode injetar nada na página.
//   - Imprimir abre a impressão do navegador, que também salva em PDF.
//   O modelo padrão é um ponto de partida: o texto final é responsabilidade da
//   empresa e deve ser revisado pelo jurídico dela (a tela diz isso).
import { A1 } from '../../shared/api/config.js';
import { esc } from '../../shared/utils/texto.js';
import { hojeISO } from '../../shared/utils/datas.js';
import { acoes } from '../../shared/ui/acoes.js';
import {
  G,
  $,
  brl,
  data,
  pessoa,
  imovel,
  contrato,
  idContrato,
  idImovel,
  endereco,
  fimContrato,
  fmtDoc,
  abrirModal,
  campo,
  opcoes,
  motivo,
  aviso,
  imprimir,
  TIPO_IMOVEL
} from './base.js';

export const TIPOS_DOC = /** @type {Record<string,string>} */ ({
  contrato_residencial: 'Contrato de locação residencial',
  contrato_comercial: 'Contrato de locação comercial',
  entrega_chaves: 'Termo de entrega de chaves'
});

const MESES = [
  'janeiro',
  'fevereiro',
  'março',
  'abril',
  'maio',
  'junho',
  'julho',
  'agosto',
  'setembro',
  'outubro',
  'novembro',
  'dezembro'
];
const extenso = (/** @type {string|null|undefined} */ iso) => {
  if (!iso) return '';
  const [a, m, d] = iso.slice(0, 10).split('-').map(Number);
  return `${d} de ${MESES[m - 1]} de ${a}`;
};
const INDICES = /** @type {Record<string,string>} */ ({
  IGPM: 'IGP-M/FGV',
  IPCA: 'IPCA/IBGE',
  INPC: 'INPC/IBGE',
  NENHUM: 'sem reajuste'
});

// Os campos que o modelo pode usar (aparecem no editor).
export const CAMPOS = /** @type {[string,string][]} */ ([
  ['administradora.nome', 'Nome da imobiliária/administradora'],
  ['hoje', 'Data de hoje por extenso'],
  ['contrato.id', 'ID do contrato (CT-0001)'],
  ['contrato.inicio', 'Início do contrato'],
  ['contrato.fim', 'Fim do contrato'],
  ['contrato.prazo_meses', 'Prazo em meses'],
  ['contrato.aluguel', 'Valor do aluguel'],
  ['contrato.dia_vencimento', 'Dia do vencimento'],
  ['contrato.indice', 'Índice de reajuste'],
  ['contrato.mes_reajuste', 'Mês do reajuste'],
  ['contrato.multa_atraso', 'Multa por atraso (%)'],
  ['contrato.juros', 'Juros ao mês (%)'],
  ['contrato.multa_rescisao', 'Multa rescisória (aluguéis)'],
  ['contrato.garantia', 'Cláusula da garantia'],
  ['contrato.encargos', 'Encargos mensais'],
  ['contrato.observacoes', 'Observações do contrato'],
  ['contrato.encerramento', 'Data de encerramento/entrega'],
  ['imovel.id', 'ID do imóvel (IM-0001)'],
  ['imovel.tipo', 'Tipo do imóvel'],
  ['imovel.endereco', 'Endereço completo do imóvel'],
  ['imovel.cidade', 'Cidade do imóvel'],
  ['locadores.qualificacao', 'Proprietários qualificados'],
  ['locadores.nomes', 'Nomes dos proprietários'],
  ['inquilino.nome', 'Nome do inquilino'],
  ['inquilino.qualificacao', 'Inquilino qualificado'],
  ['fiador.qualificacao', 'Fiador qualificado (se houver)'],
  ['assinaturas', 'Linhas de assinatura das partes']
]);

// ─── Modelos padrão ─────────────────────────────────────────────────────────
const CLAUSULAS_COMUNS = `## Cláusula 3ª – Do aluguel e do pagamento
O aluguel mensal é de {{contrato.aluguel}}, com vencimento todo dia {{contrato.dia_vencimento}} de cada mês, pago na forma indicada pela ADMINISTRADORA {{administradora.nome}}.

{{contrato.encargos}}

## Cláusula 4ª – Do reajuste
O aluguel será reajustado a cada 12 (doze) meses, no mês de {{contrato.mes_reajuste}}, pela variação acumulada do {{contrato.indice}} nos doze meses anteriores. Em caso de variação negativa, o aluguel será mantido.

## Cláusula 5ª – Do atraso
O pagamento após o vencimento sujeita o LOCATÁRIO à multa de {{contrato.multa_atraso}}% sobre o valor devido e a juros de {{contrato.juros}}% ao mês, calculados dia a dia, sem prejuízo da correção monetária.

## Cláusula 6ª – Da garantia
{{contrato.garantia}}

## Cláusula 7ª – Da conservação e das benfeitorias
O LOCATÁRIO declara receber o imóvel nas condições descritas no laudo de vistoria de entrada, que integra este contrato, obrigando-se a mantê-lo e a restituí-lo no mesmo estado, salvo as deteriorações decorrentes do uso normal (art. 23, III, da Lei 8.245/91). Benfeitorias dependem de autorização prévia e por escrito do LOCADOR.

## Cláusula 8ª – Da cessão e da sublocação
É vedado ao LOCATÁRIO ceder, sublocar ou emprestar o imóvel, no todo ou em parte, sem o consentimento prévio e por escrito do LOCADOR (art. 13 da Lei 8.245/91).

## Cláusula 9ª – Da devolução antecipada
Devolvendo o imóvel antes do fim do prazo, o LOCATÁRIO pagará multa de {{contrato.multa_rescisao}} aluguel(is), reduzida proporcionalmente ao tempo de contrato já cumprido (art. 4º da Lei 8.245/91), dispensada nos casos do parágrafo único do mesmo artigo.

## Cláusula 10 – Da vistoria e da entrega das chaves
Ao final da locação será feita vistoria de saída, comparada à de entrada. A entrega das chaves será formalizada por termo próprio, depois de quitados aluguéis e encargos.

## Cláusula 11 – Do direito de preferência
Em caso de venda, promessa de venda, cessão ou dação em pagamento, o LOCATÁRIO terá preferência para adquirir o imóvel em igualdade de condições com terceiros (art. 27 da Lei 8.245/91).

## Cláusula 12 – Das disposições gerais
{{contrato.observacoes}}

Fica eleito o foro da comarca de {{imovel.cidade}} para dirimir as questões deste contrato.

E, por estarem justas e contratadas, as partes assinam este instrumento em duas vias de igual teor, na presença de duas testemunhas.

{{imovel.cidade}}, {{hoje}}.

{{assinaturas}}`;

export const MODELOS_PADRAO = /** @type {Record<string,string>} */ ({
  contrato_residencial: `# Contrato de locação residencial
## {{contrato.id}}

**LOCADOR(ES):** {{locadores.qualificacao}}

**LOCATÁRIO:** {{inquilino.qualificacao}}

**FIADOR:** {{fiador.qualificacao}}

**ADMINISTRADORA:** {{administradora.nome}}

As partes acima contratam a locação do imóvel descrito abaixo, que se regerá pela Lei 8.245/91 e pelas cláusulas seguintes.

## Cláusula 1ª – Do imóvel
{{imovel.tipo}} situado em {{imovel.endereco}} ({{imovel.id}}), destinado exclusivamente a uso residencial do LOCATÁRIO e de sua família.

## Cláusula 2ª – Do prazo
A locação vigora por {{contrato.prazo_meses}} meses, de {{contrato.inicio}} a {{contrato.fim}}. Findo o prazo e permanecendo o LOCATÁRIO no imóvel sem oposição do LOCADOR por mais de 30 dias, a locação prorroga-se por prazo indeterminado (art. 46, § 1º, da Lei 8.245/91).

${CLAUSULAS_COMUNS}`,
  contrato_comercial: `# Contrato de locação não residencial
## {{contrato.id}}

**LOCADOR(ES):** {{locadores.qualificacao}}

**LOCATÁRIO:** {{inquilino.qualificacao}}

**FIADOR:** {{fiador.qualificacao}}

**ADMINISTRADORA:** {{administradora.nome}}

As partes acima contratam a locação do imóvel descrito abaixo, que se regerá pela Lei 8.245/91 e pelas cláusulas seguintes.

## Cláusula 1ª – Do imóvel e da destinação
{{imovel.tipo}} situado em {{imovel.endereco}} ({{imovel.id}}), destinado exclusivamente à atividade comercial do LOCATÁRIO, que responde pelas licenças e alvarás exigidos para ela.

## Cláusula 2ª – Do prazo
A locação vigora por {{contrato.prazo_meses}} meses, de {{contrato.inicio}} a {{contrato.fim}}. O direito à renovação, quando cabível, segue os arts. 51 e seguintes da Lei 8.245/91.

${CLAUSULAS_COMUNS}`,
  entrega_chaves: `# Termo de entrega e recebimento de chaves
## {{contrato.id}}

**LOCADOR(ES):** {{locadores.qualificacao}}

**LOCATÁRIO:** {{inquilino.qualificacao}}

**ADMINISTRADORA:** {{administradora.nome}}

Pelo presente termo, o LOCATÁRIO entrega e a ADMINISTRADORA, em nome do LOCADOR, recebe as chaves do imóvel situado em {{imovel.endereco}} ({{imovel.id}}), objeto do contrato {{contrato.id}}, em {{contrato.encerramento}}.

O imóvel foi vistoriado na saída. Eventuais diferenças em relação à vistoria de entrada, bem como aluguéis, encargos e consumos ainda não apurados até esta data, continuam sob responsabilidade do LOCATÁRIO e serão cobrados à parte, se houver.

Com a quitação dessas pendências, as partes dão-se mútua quitação quanto às obrigações do contrato de locação.

{{imovel.cidade}}, {{hoje}}.

{{assinaturas}}`
});

// ─── Dados do contrato para o modelo ────────────────────────────────────────
const qualifica = (/** @type {any} */ p) => {
  if (!p) return '';
  const doc = p.documento ? `${p.documento.length === 14 ? 'CNPJ' : 'CPF'} ${fmtDoc(p.documento)}` : '';
  return [p.nome, doc, p.endereco ? `com endereço em ${p.endereco}` : '', p.email ? `e-mail ${p.email}` : '']
    .filter(Boolean)
    .join(', ');
};
const garantiaTexto = (/** @type {any} */ c) => {
  const v = c.garantia_valor ? brl(c.garantia_valor) : '';
  const det = c.garantia_detalhe ? ` (${c.garantia_detalhe})` : '';
  switch (c.garantia_tipo) {
    case 'caucao':
      return `Em garantia, o LOCATÁRIO presta caução em dinheiro de ${v}${det}, a ser depositada em caderneta de poupança, revertendo em seu benefício as vantagens dela decorrentes por ocasião do levantamento (art. 38, § 2º, da Lei 8.245/91).`;
    case 'fiador':
      return `Assina este contrato, como FIADOR e principal pagador, solidariamente responsável por todas as obrigações do LOCATÁRIO até a efetiva entrega das chaves, ${qualifica(pessoa(c.fiador_id))}, renunciando ao benefício de ordem (art. 827 do Código Civil).`;
    case 'seguro_fianca':
      return `As obrigações do LOCATÁRIO são garantidas por seguro de fiança locatícia${det}${v ? `, com cobertura de ${v}` : ''}, a ser mantido vigente durante toda a locação (art. 41 da Lei 8.245/91).`;
    case 'cessao_cotas':
      return `As obrigações do LOCATÁRIO são garantidas pela cessão fiduciária de quotas de fundo de investimento${det}${v ? ` no valor de ${v}` : ''} (art. 37, IV, da Lei 8.245/91).`;
    default:
      return 'Esta locação é contratada sem garantia (art. 37 da Lei 8.245/91), o que autoriza a cobrança antecipada do aluguel nos termos do art. 42 da mesma lei.';
  }
};

export function dadosDoContrato(/** @type {any} */ c) {
  const i = imovel(c.imovel_id) || {};
  const donos = G.donos.filter(d => d.imovel_id === c.imovel_id).map(d => ({ ...d, p: pessoa(d.pessoa_id) }));
  const inq = pessoa(c.inquilino_id);
  const fia = c.garantia_tipo === 'fiador' ? pessoa(c.fiador_id) : null;
  const encargos = (c.encargos || []).filter((/** @type {any} */ e) => e.descricao);
  const assinar = (/** @type {string} */ papel, /** @type {any} */ p) =>
    p ? `________________________________________\n${p.nome}\n${papel}` : '';
  return /** @type {Record<string,string>} */ ({
    // sem o nome da empresa, o campo fica marcado como faltando (não some calado)
    ...((A1.user || {}).tenant_name ? { 'administradora.nome': A1.user.tenant_name } : {}),
    hoje: extenso(hojeISO()),
    'contrato.id': idContrato(c),
    'contrato.inicio': data(c.data_inicio),
    'contrato.fim': data(fimContrato(c)),
    'contrato.prazo_meses': String(c.prazo_meses),
    'contrato.aluguel': brl(c.valor_aluguel),
    'contrato.dia_vencimento': String(c.dia_vencimento),
    'contrato.indice': INDICES[c.indice_reajuste] || c.indice_reajuste,
    'contrato.mes_reajuste':
      MESES[(Number(c.mes_reajuste) || Number(String(c.data_inicio).slice(5, 7))) - 1] || '',
    'contrato.multa_atraso': String(Number(c.multa_atraso_pct)),
    'contrato.juros': String(Number(c.juros_mes_pct)),
    'contrato.multa_rescisao': String(Number(c.multa_rescisao_alugueis)),
    'contrato.garantia': garantiaTexto(c),
    'contrato.encargos': encargos.length
      ? `Além do aluguel, o LOCATÁRIO pagará mensalmente, junto com ele: ${encargos
          .map((/** @type {any} */ e) => `${e.descricao} (${brl(e.valor)})`)
          .join('; ')}.`
      : '',
    'contrato.observacoes': c.observacoes || '',
    'contrato.encerramento': extenso(c.encerrado_em || hojeISO()),
    'imovel.id': idImovel(i),
    'imovel.tipo': TIPO_IMOVEL[i.tipo] || 'Imóvel',
    'imovel.endereco': [endereco(i), [i.cidade, i.uf].filter(Boolean).join('/'), i.cep ? `CEP ${i.cep}` : '']
      .filter(Boolean)
      .join(', '),
    'imovel.cidade': i.cidade || '',
    'locadores.qualificacao': donos
      .map(d => `${qualifica(d.p)}${donos.length > 1 ? ` (${Number(d.percentual)}%)` : ''}`)
      .join('; '),
    'locadores.nomes': donos.map(d => (d.p || {}).nome || '').join(', '),
    'inquilino.nome': (inq || {}).nome || '',
    'inquilino.qualificacao': qualifica(inq),
    'fiador.qualificacao': fia ? qualifica(fia) : 'não há',
    assinaturas: [
      ...donos.map(d => assinar('LOCADOR', d.p)),
      assinar('LOCATÁRIO', inq),
      fia ? assinar('FIADOR', fia) : '',
      '________________________________________\nTestemunha 1 (nome e CPF)',
      '________________________________________\nTestemunha 2 (nome e CPF)'
    ]
      .filter(Boolean)
      .join('\n\n')
  });
}

/**
 * Troca {{campo}} pelos dados e converte as marcações em HTML. Tudo é escapado
 * antes: modelo e dados não viram HTML. Campo desconhecido fica marcado.
 */
// Marcadores (uso privado do Unicode) para o campo que faltou: sobrevivem ao esc().
const FALTA_A = '\uE000';
const FALTA_F = '\uE001';
const FALTA_RE = new RegExp(`${FALTA_A}([\\w.]+)${FALTA_F}`, 'g');
export function renderizar(/** @type {string} */ texto, /** @type {Record<string,string>} */ dados) {
  const comDados = String(texto).replace(/\{\{\s*([\w.]+)\s*\}\}/g, (m, k) =>
    k in dados ? dados[k] : `${FALTA_A}${k}${FALTA_F}`
  );
  const linha = (/** @type {string} */ t) =>
    esc(t)
      .replace(/\*\*(.+?)\*\*/g, '<b>$1</b>')
      .replace(FALTA_RE, '<mark class="lc-doc-falta">{{$1}}</mark>');
  const html = [];
  // Linha em branco fecha o parágrafo; título ("# "/"## ") é sempre uma linha
  // própria, mesmo sem linha em branco antes ou depois.
  let par = /** @type {string[]} */ ([]);
  const fecha = () => {
    if (par.length) html.push(`<p>${par.map(linha).join('<br>')}</p>`);
    par = [];
  };
  for (const bruta of comDados.replace(/\r\n/g, '\n').split('\n')) {
    const l = bruta.trim();
    if (!l) fecha();
    else if (l.startsWith('## ')) {
      fecha();
      html.push(`<h2>${linha(l.slice(3))}</h2>`);
    } else if (l.startsWith('# ')) {
      fecha();
      html.push(`<h1>${linha(l.slice(2))}</h1>`);
    } else par.push(l);
  }
  fecha();
  return html.join('');
}

export const modeloDe = (/** @type {string} */ tipo) =>
  (G.modelos.find(m => m.tipo === tipo) || {}).texto || MODELOS_PADRAO[tipo] || '';
const tipoContrato = (/** @type {any} */ c) =>
  c.finalidade === 'comercial' ? 'contrato_comercial' : 'contrato_residencial';

// ─── Ações ──────────────────────────────────────────────────────────────────
acoes({
  lcDocumento: el => abrirDocumento(el.dataset.id || '', el.dataset.tipo || ''),
  lcModelos: () => editarModelos('contrato_residencial'),
  lcModeloTipo: el => editarModelos(/** @type {HTMLSelectElement} */ (el).value),
  lcModeloPadrao: () => {
    const t = /** @type {HTMLTextAreaElement} */ ($('lm-texto'));
    t.value = MODELOS_PADRAO[campo('lm-tipo')] || '';
    previaModelo();
  },
  lcModeloPrevia: () => previaModelo()
});

export function abrirDocumento(/** @type {string} */ id, /** @type {string} */ tipo) {
  const c = contrato(id);
  if (!c) return;
  const t = tipo || tipoContrato(c);
  const html = `<article class="lc-doc">${renderizar(modeloDe(t), dadosDoContrato(c))}</article>`;
  abrirModal(
    `${TIPOS_DOC[t]} · ${idContrato(c)}`,
    `<p class="lc-dica">Gerado do modelo ${G.modelos.some(m => m.tipo === t) ? 'da sua empresa' : 'padrão do SIIMOB'}. Revise antes de assinar; o texto do modelo é editável em Contratos › Modelos.</p>
     <div class="lc-doc-previa" id="lc-doc-previa">${html}</div>`,
    async () => {
      imprimir(html);
      return 'manter';
    },
    'Imprimir / salvar PDF'
  );
}

function editarModelos(/** @type {string} */ tipo) {
  const t = TIPOS_DOC[tipo] ? tipo : 'contrato_residencial';
  const proprio = G.modelos.some(m => m.tipo === t);
  abrirModal(
    'Modelos de documento',
    `<div class="lc-form">
      <label class="lc-largo">Documento<select id="lm-tipo" data-acao-change="lcModeloTipo">${opcoes(TIPOS_DOC, t)}</select></label>
      <p class="lc-largo lc-dica">${proprio ? 'Este é o modelo da sua empresa.' : 'Este é o modelo padrão do SIIMOB. Ao salvar, ele vira o modelo da sua empresa.'} O modelo padrão é um ponto de partida: revise o texto com o jurídico da empresa. Marcações: "# " título, "## " seção, **negrito**, linha em branco separa parágrafos.</p>
      <label class="lc-largo">Texto<textarea id="lm-texto" rows="16" maxlength="60000" class="lc-mono-area" data-acao-input="lcModeloPrevia">${esc(modeloDe(t))}</textarea></label>
      <details class="lc-largo lc-campos"><summary>Campos disponíveis</summary>
        <ul>${CAMPOS.map(([k, r]) => `<li><code>{{${esc(k)}}}</code> ${esc(r)}</li>`).join('')}</ul></details>
      <div class="lc-largo lc-donos-pe"><button type="button" class="lc-btn lc-btn-p" data-acao="lcModeloPadrao">Voltar ao modelo padrão</button></div>
      <div class="lc-largo"><b class="lc-dica">Prévia${G.contratos.length ? ` com ${esc(idContrato(G.contratos[0]))}` : ''}</b>
        <div class="lc-doc-previa lc-doc-previa-p" id="lm-previa"></div></div>
    </div>`,
    async () => {
      const texto = /** @type {HTMLTextAreaElement} */ ($('lm-texto')).value;
      const tp = campo('lm-tipo');
      if (texto.trim().length < 20) throw new Error('O modelo precisa de texto.');
      const r = await fetch(`${A1.rest('a1_lc_modelos')}?on_conflict=tenant_id,tipo`, {
        method: 'POST',
        headers: A1.headers({ Prefer: 'resolution=merge-duplicates,return=minimal' }),
        body: JSON.stringify({
          tenant_id: (A1.user || {}).tenant_id,
          tipo: tp,
          texto,
          atualizado_em: new Date().toISOString()
        })
      });
      if (!r.ok) throw new Error(await motivo(r));
      aviso(`Modelo "${TIPOS_DOC[tp]}" salvo.`);
    },
    'Salvar modelo'
  );
  previaModelo();
}

function previaModelo() {
  const alvo = document.getElementById('lm-previa');
  if (!alvo) return;
  const c = G.contratos[0];
  const texto = /** @type {HTMLTextAreaElement} */ ($('lm-texto')).value;
  alvo.innerHTML = c
    ? `<article class="lc-doc">${renderizar(texto, dadosDoContrato(c))}</article>`
    : '<p class="lc-vazio">Cadastre um contrato para ver a prévia com dados.</p>';
}
