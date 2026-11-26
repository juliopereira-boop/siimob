// ─── Locação: estado, formatação, banco e modal compartilhados ───────────────
//
// Usado pela tela (src/pages/locacao/main.js) e pelos módulos de documento e
// vistoria. `ganchos.redesenhar` é preenchido pela tela: quem grava chama
// recarregar() e a tela inteira se redesenha com os dados novos.
import { A1 } from '../../shared/api/config.js';
import { esc } from '../../shared/utils/texto.js';
import { hojeISO } from '../../shared/utils/datas.js';

export const ganchos = { redesenhar: () => {} };
export const TIPO_IMOVEL = /** @type {Record<string,string>} */ ({
  apartamento: 'Apartamento',
  casa: 'Casa',
  sala: 'Sala',
  loja: 'Loja',
  galpao: 'Galpão',
  terreno: 'Terreno',
  outro: 'Outro'
});
export const SIT_IMOVEL = /** @type {Record<string,string>} */ ({
  disponivel: 'Disponível',
  alugado: 'Alugado',
  manutencao: 'Em manutenção',
  inativo: 'Inativo'
});
export const GARANTIA = /** @type {Record<string,string>} */ ({
  nenhuma: 'Sem garantia',
  caucao: 'Caução',
  fiador: 'Fiador',
  seguro_fianca: 'Seguro-fiança',
  cessao_cotas: 'Cessão de cotas de fundo'
});
export const ST_CONTRATO = /** @type {Record<string,string>} */ ({
  rascunho: 'Rascunho',
  ativo: 'Ativo',
  encerrado: 'Encerrado',
  rescindido: 'Rescindido'
});
export const FORMAS = /** @type {Record<string,string>} */ ({
  pix: 'PIX',
  boleto: 'Boleto',
  transferencia: 'Transferência',
  dinheiro: 'Dinheiro',
  outro: 'Outro'
});
export const PAPEIS = /** @type {Record<string,string>} */ ({
  proprietario: 'Proprietário',
  inquilino: 'Inquilino',
  fiador: 'Fiador'
});
export const ERROS = /** @type {Record<string,string>} */ ({
  sem_permissao: 'Só o gestor da empresa, com o módulo Locação liberado, pode fazer isso.',
  proprietarios_nao_somam_100:
    'As partes dos proprietários do imóvel precisam somar 100%. Ajuste em Imóveis.',
  imovel_ja_alugado: 'Este imóvel já tem um contrato ativo.',
  contrato_nao_e_rascunho: 'Só contrato em rascunho pode ser ativado ou editado.',
  contrato_nao_ativo: 'O contrato não está ativo.',
  cobranca_nao_aberta: 'Esta cobrança não está mais em aberto. A tela foi atualizada.',
  cobranca_nao_paga: 'Esta cobrança não está paga.',
  versao_desatualizada:
    'Outra pessoa mexeu nesta cobrança agora. A tela foi atualizada; confira e tente de novo.',
  repasse_ja_pago: 'Um repasse desta cobrança já foi pago: não dá para estornar.',
  repasse_nao_pendente: 'Este repasse já foi pago ou cancelado.',
  motivo_obrigatorio: 'Informe o motivo.',
  data_invalida: 'Data inválida (não pode ser futura).',
  desconto_invalido: 'Desconto inválido.',
  lancamento_ja_repassado: 'Este lançamento já entrou num repasse e não pode mudar.',
  referencia_de_outro_cliente: 'Registro de outra empresa.',
  a1_lc_garantia_coerente:
    'Confira a garantia: fiador exige escolher a pessoa; caução exige o valor, de até 3 aluguéis (Lei 8.245, art. 38).',
  a1_lc_pessoas_doc_uq: 'Já existe uma pessoa com este CPF/CNPJ.',
  a1_lc_um_ativo_por_imovel: 'Este imóvel já tem um contrato ativo.',
  contrato_nao_encontrado: 'Contrato não encontrado.',
  reajuste_nao_devido: 'Este contrato não tem reajuste devido agora.',
  reajuste_ja_aplicado: 'O reajuste deste ano já foi aplicado.',
  indice_indisponivel: 'O índice deste período ainda não foi publicado. Informe o percentual para aplicar.',
  percentual_invalido: 'Percentual inválido (de −50% a 100%).',
  prazo_invalido: 'Prazo inválido (de 1 a 120 meses por renovação; até 600 no total).',
  valor_invalido: 'Valor inválido.',
  a1_lc_prazo_valido: 'Prazo inválido (até 600 meses).',
  vistoria_sem_itens: 'Inclua ao menos um item antes de concluir a vistoria.',
  vistoria_concluida: 'Esta vistoria já foi concluída e não muda mais.',
  vistoria_nao_encontrada: 'Vistoria não encontrada.'
});

export const G = {
  vista: 'painel',
  pessoas: /** @type {any[]} */ ([]),
  imoveis: /** @type {any[]} */ ([]),
  donos: /** @type {any[]} */ ([]),
  contratos: /** @type {any[]} */ ([]),
  cobrancas: /** @type {any[]} */ ([]),
  repasses: /** @type {any[]} */ ([]),
  lancamentos: /** @type {any[]} */ ([]),
  aditivos: /** @type {any[]} */ ([]),
  modelos: /** @type {any[]} */ ([]),
  vistorias: /** @type {any[]} */ ([]),
  indices: /** @type {any[]} */ ([]),
  filtro: { competencia: hojeISO().slice(0, 7), status: 'todas', busca: '' },
  salvar: /** @type {null|(() => Promise<any>)} */ (null),
  ocupado: false
};
export const $ = (/** @type {string} */ id) => /** @type {HTMLElement} */ (document.getElementById(id));

// ─── Formatação ──────────────────────────────────────────────────────────────
export const brl = (/** @type {any} */ v) =>
  Number(v || 0).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
export const data = (/** @type {string|null|undefined} */ d) =>
  d ? d.slice(0, 10).split('-').reverse().join('/') : '';
export const mes = (/** @type {string} */ d) => {
  const [a, m] = String(d || '').split('-');
  return a && m ? `${m}/${a}` : '';
};
export const num = (/** @type {string} */ s) => {
  const t = String(s ?? '').trim();
  if (!t) return NaN;
  return Number(t.includes(',') ? t.replace(/\./g, '').replace(',', '.') : t);
};
export const dias = (/** @type {string} */ a, /** @type {string} */ b) =>
  Math.round((Date.parse(b + 'T00:00:00Z') - Date.parse(a + 'T00:00:00Z')) / 86400000);
export const somaMeses = (/** @type {string} */ iso, /** @type {number} */ n) => {
  const [a, m, d] = iso.split('-').map(Number);
  const dt = new Date(Date.UTC(a, m - 1 + n, d));
  return dt.toISOString().slice(0, 10);
};
export const pessoa = (/** @type {string|null} */ id) => G.pessoas.find(p => p.id === id) || null;
export const imovel = (/** @type {string|null} */ id) => G.imoveis.find(i => i.id === id) || null;
export const contrato = (/** @type {string|null} */ id) => G.contratos.find(c => c.id === id) || null;
export const endereco = (/** @type {any} */ i) =>
  i ? [i.logradouro, i.numero, i.complemento, i.bairro].filter(Boolean).join(', ') : '';
const pad4 = (/** @type {any} */ n) => String(n || 0).padStart(4, '0');
/** ID automático (coluna seq, preenchida pelo banco). */
export const idContrato = (/** @type {any} */ c) => (c && c.seq ? `CT-${pad4(c.seq)}` : 'CT-····');
export const idImovel = (/** @type {any} */ i) => (i && i.seq ? `IM-${pad4(i.seq)}` : 'IM-····');
export const nomeImovel = (/** @type {any} */ i) => (i ? `${idImovel(i)} · ${endereco(i)}` : '—');
export const fimContrato = (/** @type {any} */ c) => somaMeses(c.data_inicio, Number(c.prazo_meses));
export const atrasada = (/** @type {any} */ b) => b.status === 'aberta' && b.vencimento < hojeISO();
export const stCobranca = (/** @type {any} */ b) =>
  atrasada(b) ? 'atrasada' : b.status === 'aberta' ? 'aberta' : b.status === 'paga' ? 'paga' : 'cancelada';
export const ROT_COB = /** @type {Record<string,string>} */ ({
  aberta: 'Em aberto',
  atrasada: 'Atrasada',
  paga: 'Paga',
  cancelada: 'Cancelada'
});
export const selo = (/** @type {string} */ tipo, /** @type {string} */ texto) =>
  `<span class="lc-selo lc-selo-${esc(tipo)}">${esc(texto)}</span>`;

export function aviso(/** @type {string} */ msg, tipo = 'ok') {
  const d = document.createElement('div');
  d.className = `lc-toast lc-toast-${tipo}`;
  d.textContent = msg;
  $('lc-toasts').appendChild(d);
  setTimeout(() => d.remove(), 4500);
}
export async function motivo(/** @type {Response} */ r) {
  const t = await r.text().catch(() => '');
  const chave = Object.keys(ERROS).find(k => t.includes(k));
  return chave ? ERROS[chave] : 'Não foi possível concluir agora. Confira os dados e tente de novo.';
}

// ─── Banco ───────────────────────────────────────────────────────────────────
export async function ler(/** @type {string} */ tabela, /** @type {string} */ ordem) {
  const r = await A1.buscarTudo(`${A1.rest(tabela)}?select=*&order=${ordem}`);
  return (r && r.linhas) || [];
}
export async function carregar() {
  const [
    pessoas,
    imoveis,
    donos,
    contratos,
    cobrancas,
    repasses,
    lancamentos,
    aditivos,
    modelos,
    vistorias,
    indices
  ] = await Promise.all([
    ler('a1_lc_pessoas', 'nome.asc,id.asc'),
    ler('a1_lc_imoveis', 'criado_em.desc,id.desc'),
    ler('a1_lc_imovel_donos', 'imovel_id.asc'),
    ler('a1_lc_contratos', 'criado_em.desc,id.desc'),
    ler('a1_lc_cobrancas', 'vencimento.desc,id.desc'),
    ler('a1_lc_repasses', 'criado_em.desc,id.desc'),
    ler('a1_lc_lancamentos', 'criado_em.desc,id.desc'),
    ler('a1_lc_aditivos', 'criado_em.desc,id.desc'),
    ler('a1_lc_modelos', 'tipo.asc'),
    ler('a1_lc_vistorias', 'data.desc,id.desc'),
    // índices são poucos e públicos: os meses mais recentes de cada um bastam
    A1.buscarTudo(`${A1.rest('a1_lc_indices')}?select=indice,mes,valor&order=mes.desc&limit=80`, {
      chave: false
    }).then(r => (r && r.linhas) || [])
  ]);
  Object.assign(G, {
    pessoas,
    imoveis,
    donos,
    contratos,
    cobrancas,
    repasses,
    lancamentos,
    aditivos,
    modelos,
    vistorias,
    indices
  });
}
/** Recarrega tudo e redesenha a tela. */
export async function recarregar() {
  await carregar().catch(() => {});
  ganchos.redesenhar();
}
export async function gravar(
  /** @type {string} */ tabela,
  /** @type {any} */ corpo,
  /** @type {string|null} */ id
) {
  const r = await fetch(id ? `${A1.rest(tabela)}?id=eq.${encodeURIComponent(id)}` : A1.rest(tabela), {
    method: id ? 'PATCH' : 'POST',
    headers: A1.returnHeaders(),
    body: JSON.stringify(corpo)
  });
  if (!r.ok) throw new Error(await motivo(r));
  const linhas = await r.json().catch(() => []);
  if (id && (!Array.isArray(linhas) || !linhas.length))
    throw new Error('Não foi possível salvar (registro não encontrado ou travado).');
  return Array.isArray(linhas) ? linhas[0] : linhas;
}
export async function rpc(/** @type {string} */ fn, /** @type {any} */ args) {
  const r = await fetch(A1.rpc(fn), { method: 'POST', headers: A1.headers(), body: JSON.stringify(args) });
  if (!r.ok) throw new Error(await motivo(r));
  return r.json().catch(() => ({}));
}
/** Roda uma ação com o botão travado, recarrega e redesenha. */
export async function executar(/** @type {() => Promise<any>} */ fn, /** @type {string} */ ok) {
  if (G.ocupado) return;
  G.ocupado = true;
  try {
    await fn();
    if (ok) aviso(ok);
  } catch (e) {
    aviso(/** @type {Error} */ (e).message, 'erro');
  } finally {
    G.ocupado = false;
    await recarregar();
  }
}

// ─── Modal ───────────────────────────────────────────────────────────────────
export function abrirModal(
  /** @type {string} */ titulo,
  /** @type {string} */ corpo,
  /** @type {null|(() => Promise<any>)} */ salvar,
  rotulo = 'Salvar'
) {
  $('lc-modal-titulo').textContent = titulo;
  $('lc-modal-corpo').innerHTML = corpo;
  $('lc-modal-erro').hidden = true;
  // Sem `salvar`, é só leitura: um botão Fechar.
  $('lc-modal-pe').innerHTML = salvar
    ? `<button type="button" class="lc-btn" data-acao="lcFechar">Cancelar</button>
    <button type="button" class="lc-btn lc-btn-forte" data-acao="lcSalvarModal" id="lc-modal-ok">${esc(rotulo)}</button>`
    : '<button type="button" class="lc-btn" data-acao="lcFechar">Fechar</button>';
  G.salvar = salvar;
  $('lc-fundo').hidden = false;
  const primeiro = /** @type {HTMLElement|null} */ (
    $('lc-modal-corpo').querySelector('input,select,textarea')
  );
  if (primeiro) primeiro.focus();
}
export function fecharModal() {
  $('lc-fundo').hidden = true;
  G.salvar = null;
}
export async function salvarModal() {
  if (!G.salvar || G.ocupado) return;
  const b = /** @type {HTMLButtonElement} */ ($('lc-modal-ok'));
  b.disabled = true;
  G.ocupado = true;
  try {
    // 'manter': o modal continua aberto (ex.: editor que salva e segue).
    const r = await G.salvar();
    if (r !== 'manter') fecharModal();
    G.ocupado = false;
    await recarregar();
  } catch (e) {
    const msg = /** @type {Error} */ (e).message;
    // Outra pessoa mexeu na cobrança: o modal está com a versão velha. Fecha,
    // recarrega e avisa (a mensagem promete que a tela foi atualizada).
    if (msg === ERROS.versao_desatualizada || msg === ERROS.cobranca_nao_aberta) {
      fecharModal();
      aviso(msg, 'erro');
      G.ocupado = false;
      await recarregar();
      return;
    }
    $('lc-modal-erro').textContent = msg;
    $('lc-modal-erro').hidden = false;
  } finally {
    G.ocupado = false;
    b.disabled = false;
  }
}
export const campo = (/** @type {string} */ id) => /** @type {HTMLInputElement} */ ($(id)).value.trim();
export const opcoes = (/** @type {Record<string,string>} */ m, /** @type {string} */ atual) =>
  Object.entries(m)
    .map(([k, v]) => `<option value="${esc(k)}"${k === atual ? ' selected' : ''}>${esc(v)}</option>`)
    .join('');
export const opcoesPessoas = (
  /** @type {string} */ papel,
  /** @type {string|null} */ atual,
  vazio = '— selecione —'
) =>
  `<option value="">${esc(vazio)}</option>` +
  G.pessoas
    .filter(p => p.ativo !== false && (!papel || (p.papeis || []).includes(papel) || p.id === atual))
    .map(p => `<option value="${esc(p.id)}"${p.id === atual ? ' selected' : ''}>${esc(p.nome)}</option>`)
    .join('');

export const tabela = (
  /** @type {string[]} */ cab,
  /** @type {string[]} */ linhas,
  vazio = 'Nada por aqui ainda.'
) =>
  linhas.length
    ? `<div class="lc-tbl"><table><thead><tr>${cab.map(c => `<th>${esc(c)}</th>`).join('')}</tr></thead><tbody>${linhas.join('')}</tbody></table></div>`
    : `<p class="lc-vazio">${esc(vazio)}</p>`;

export const fmtDoc = (/** @type {string|null} */ d) =>
  !d
    ? ''
    : d.length === 11
      ? d.replace(/(\d{3})(\d{3})(\d{3})(\d{2})/, '$1.$2.$3-$4')
      : d.replace(/(\d{2})(\d{3})(\d{3})(\d{4})(\d{2})/, '$1.$2.$3/$4-$5');

/**
 * Imprime (ou salva em PDF pelo navegador) um HTML já montado e escapado.
 * O conteúdo vai para #lc-impressao; o CSS de impressão esconde o resto.
 */
export function imprimir(/** @type {string} */ html) {
  let alvo = document.getElementById('lc-impressao');
  if (!alvo) {
    alvo = document.createElement('div');
    alvo.id = 'lc-impressao';
    document.body.appendChild(alvo);
  }
  alvo.innerHTML = html;
  document.body.classList.add('lc-imprimindo');
  const fim = () => {
    document.body.classList.remove('lc-imprimindo');
    window.removeEventListener('afterprint', fim);
  };
  window.addEventListener('afterprint', fim);
  window.print();
  setTimeout(fim, 1500);
}
