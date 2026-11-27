// ─── Financeiro · Conciliação bancária por OFX (fase 2) ──────────────────────
//
// COMO FUNCIONA
//   - O arquivo OFX (o "extrato para Money/Quicken" que todo banco brasileiro
//     exporta) é lido aqui no navegador: só data, valor, descrição e o código
//     da transação (FITID) vão para o banco (a1_fin_extrato_importar). A mesma
//     linha importada duas vezes não repete (conta + FITID).
//   - Cada linha pendente recebe sugestões (a1_fin_extrato_sugestoes):
//     lançamento do mesmo sentido e valor perto da data, ou parcela da carteira
//     cujo valor do dia bate. "Conciliar automático" só fecha o que tem um
//     único candidato a até 3 dias.
//   - Sem par: vira um lançamento pago na hora, com categoria e centro de custo.
//   - Tudo que vem do banco ou do arquivo passa por esc().
import { esc } from '../../shared/utils/texto.js';
import { acoes } from '../../shared/ui/acoes.js';
import { F } from './ctx.js';

export const ERROS_CONCILIACAO = /** @type {Record<string,string>} */ ({
  extrato_vazio: 'Nenhuma transação encontrada no arquivo.',
  extrato_grande: 'Arquivo grande demais: importe no máximo 5.000 linhas por vez.',
  item_nao_encontrado: 'Linha do extrato não encontrada.',
  item_ja_conciliado: 'Esta linha já foi conciliada. A tela foi atualizada.',
  escolha_um: 'Escolha um lançamento ou uma parcela.',
  sentido_diferente: 'Entrada só concilia com conta a receber, e saída com conta a pagar.',
  lancamento_ja_conciliado: 'Este lançamento já está ligado a outra linha do extrato.',
  valor_maior_que_o_lancamento: 'O valor do extrato é maior que o do lançamento.',
  lancamento_cancelado: 'Este lançamento foi cancelado.',
  acao_invalida: 'Ação inválida.'
});

// ─── Leitura do OFX ──────────────────────────────────────────────────────────
/** Texto do arquivo: UTF-8 quando válido, senão Windows-1252 (o padrão dos bancos). */
export function decodificarOfx(/** @type {ArrayBuffer} */ buf) {
  const bytes = new Uint8Array(buf);
  const cab = new TextDecoder('latin1').decode(bytes.slice(0, 600));
  if (!/CHARSET:\s*1252|encoding="?(windows-1252|iso-8859-1)/i.test(cab)) {
    try {
      return new TextDecoder('utf-8', { fatal: true }).decode(bytes);
    } catch {
      /* cai para 1252 */
    }
  }
  return new TextDecoder('windows-1252').decode(bytes);
}

const ENT = /** @type {Record<string,string>} */ ({
  amp: '&',
  lt: '<',
  gt: '>',
  quot: '"',
  apos: "'",
  nbsp: ' '
});
const limpar = (/** @type {string} */ s) =>
  s
    .replace(/&(amp|lt|gt|quot|apos|nbsp);/g, (_, e) => ENT[e])
    .replace(/&#(\d{1,5});/g, (_, n) => String.fromCharCode(Number(n)))
    .replace(/\s+/g, ' ')
    .trim();

/** Valor de uma tag no bloco: SGML (<TAG>valor) ou XML (<TAG>valor</TAG>). */
function tag(/** @type {string} */ bloco, /** @type {string} */ nome) {
  const m = new RegExp(`<${nome}>([^<\\r\\n]*)`, 'i').exec(bloco);
  return m ? limpar(m[1]) : '';
}

/** Data OFX (AAAAMMDD[HHMMSS[.XXX][-3:BRT]]) para AAAA-MM-DD. */
export function dataOfx(/** @type {string} */ s) {
  const m = /^(\d{4})(\d{2})(\d{2})/.exec(String(s || '').trim());
  if (!m) return null;
  const [, a, mm, d] = m;
  const t = Date.UTC(Number(a), Number(mm) - 1, Number(d));
  const iso = new Date(t).toISOString().slice(0, 10);
  return iso === `${a}-${mm}-${d}` ? iso : null;
}

/** Valor OFX: "-1234.56", "1234,56", "+10". */
export function valorOfx(/** @type {string} */ s) {
  let t = String(s || '')
    .trim()
    .replace(/\s/g, '');
  if (!t) return NaN;
  if (t.includes(',') && t.includes('.'))
    t =
      t.lastIndexOf(',') > t.lastIndexOf('.') ? t.replace(/\./g, '').replace(',', '.') : t.replace(/,/g, '');
  else if (t.includes(',')) t = t.replace(',', '.');
  const n = Number(t);
  return Number.isFinite(n) ? Math.round(n * 100) / 100 : NaN;
}

/**
 * Lê o OFX e devolve as transações e a conta do arquivo.
 * @returns {{itens: {fitid:string, data:string, valor:number, descricao:string}[], banco:string, conta:string, inicio:string|null, fim:string|null}}
 */
export function lerOfx(/** @type {string} */ texto) {
  const s = String(texto || '');
  if (!/<OFX>/i.test(s)) throw new Error('Este arquivo não parece um OFX (extrato do banco).');
  const blocos = s
    .split(/<STMTTRN>/i)
    .slice(1)
    .map(b => b.split(/<\/STMTTRN>|<\/BANKTRANLIST>/i)[0]);
  const itens = [];
  for (const b of blocos) {
    const data = dataOfx(tag(b, 'DTPOSTED'));
    const valor = valorOfx(tag(b, 'TRNAMT'));
    if (!data || !Number.isFinite(valor) || valor === 0) continue;
    const memo = tag(b, 'MEMO');
    const nome = tag(b, 'NAME');
    const descricao = (
      memo && nome && !memo.includes(nome) ? `${nome} · ${memo}` : memo || nome || tag(b, 'TRNTYPE')
    ).slice(0, 255);
    itens.push({ fitid: tag(b, 'FITID').slice(0, 120), data, valor, descricao });
  }
  return {
    itens,
    banco: tag(s, 'BANKID'),
    conta: tag(s, 'ACCTID'),
    inicio: dataOfx(tag(s, 'DTSTART')),
    fim: dataOfx(tag(s, 'DTEND'))
  };
}

// ─── Tela ────────────────────────────────────────────────────────────────────
acoes({
  fnExtImportar: () => formImportar(),
  fnExtArquivo: el => lerArquivo(/** @type {HTMLInputElement} */ (el)),
  fnExtAuto: () => conciliarAuto(),
  fnExtAbrir: el => abrirItem(el.dataset.id || ''),
  fnExtUsar: el => usarSugestao(el.dataset.item || '', el.dataset.tipo || '', el.dataset.id || ''),
  fnExtCriar: el => formCriar(el.dataset.id || ''),
  fnExtIgnorar: el => marcar(el.dataset.id || '', 'ignorar'),
  fnExtDesfazer: el => marcar(el.dataset.id || '', 'desfazer')
});

const contaAtual = () => {
  const ativas = F.G.contas.filter((/** @type {any} */ c) => c.ativo);
  const f = F.G.filtro.contaExt;
  return ativas.find((/** @type {any} */ c) => c.id === f) || ativas[0] || null;
};
const ST_EXT = /** @type {Record<string,string>} */ ({
  pendente: 'Pendente',
  conciliado: 'Conciliado',
  ignorado: 'Ignorado'
});

export function botoesConciliacao() {
  return `<button type="button" class="lc-btn" data-acao="fnExtAuto">Conciliar automático</button>
    <button type="button" class="lc-btn lc-btn-forte" data-acao="fnExtImportar">Importar OFX</button>`;
}
export function filtrosConciliacao() {
  const c = contaAtual();
  return `<label>Conta <select id="fn-f-conta" data-acao-change="fnFiltrar">${F.G.contas
    .filter((/** @type {any} */ x) => x.ativo)
    .map(
      (/** @type {any} */ x) =>
        `<option value="${esc(x.id)}"${c && x.id === c.id ? ' selected' : ''}>${esc(x.nome)}</option>`
    )
    .join('')}</select></label>
    <label>Situação <select id="fn-f-ext" data-acao-change="fnFiltrar">${F.opcoes({ pendente: 'Pendentes', conciliado: 'Conciliadas', ignorado: 'Ignoradas', todas: 'Todas' }, F.G.filtro.ext || 'pendente')}</select></label>
    <input type="search" id="fn-f-busca" placeholder="Buscar descrição ou valor" value="${esc(F.G.filtro.busca)}" data-acao-input="fnFiltrar">`;
}

export function vistaConciliacao() {
  const c = contaAtual();
  if (!c) return '<p class="lc-vazio">Cadastre uma conta bancária em Cadastros para importar o extrato.</p>';
  const st = F.G.filtro.ext || 'pendente';
  const q = F.G.filtro.busca;
  const daConta = F.G.extrato.filter((/** @type {any} */ i) => i.conta_id === c.id);
  const lista = daConta.filter((/** @type {any} */ i) => {
    if (st !== 'todas' && i.status !== st) return false;
    if (!q) return true;
    return `${i.descricao || ''} ${F.brl(Math.abs(i.valor))} ${Math.abs(i.valor)}`.toLowerCase().includes(q);
  });
  const pend = daConta.filter((/** @type {any} */ i) => i.status === 'pendente');
  const soma = (/** @type {any[]} */ l, /** @type {number} */ sinal) =>
    l.filter(i => Math.sign(i.valor) === sinal).reduce((s, i) => s + Math.abs(Number(i.valor)), 0);
  const ult = F.G.extratos.find((/** @type {any} */ e) => e.conta_id === c.id);
  const lancs = new Map(F.G.lancamentos.map((/** @type {any} */ l) => [l.id, l]));
  const linha = (/** @type {any} */ i) => {
    const l = i.lancamento_id ? lancs.get(i.lancamento_id) : null;
    return `<tr>
      <td>${esc(F.data(i.data))}</td>
      <td>${esc(i.descricao || '—')}${l ? `<small>↔ ${esc(l.descricao)}</small>` : ''}</td>
      <td class="lc-num"><b class="${i.valor < 0 ? 'fn-saida' : 'fn-entrada'}">${esc(F.brl(i.valor))}</b></td>
      <td>${F.selo(i.status === 'conciliado' ? 'ok' : i.status === 'ignorado' ? 'off' : 'alerta', ST_EXT[i.status] || i.status)}</td>
      <td class="lc-acoes">${
        i.status === 'pendente'
          ? `<button class="lc-btn lc-btn-p lc-btn-forte" data-acao="fnExtAbrir" data-id="${esc(i.id)}">Conciliar</button>
             <button class="lc-btn lc-btn-p" data-acao="fnExtIgnorar" data-id="${esc(i.id)}">Ignorar</button>`
          : `<button class="lc-btn lc-btn-p" data-acao="fnExtDesfazer" data-id="${esc(i.id)}">Desfazer</button>`
      }</td></tr>`;
  };
  return `<div class="lc-kpis">
      ${F.kpi('Pendentes', String(pend.length), `entradas ${F.brl(soma(pend, 1))} · saídas ${F.brl(soma(pend, -1))}`, pend.length ? 'lc-kpi-alerta' : '')}
      ${F.kpi('Conciliadas', String(daConta.filter((/** @type {any} */ i) => i.status === 'conciliado').length), 'nos últimos 120 dias')}
      ${F.kpi('Último extrato', ult ? `${F.data(ult.inicio)} a ${F.data(ult.fim)}` : '—', ult ? `${ult.novos} nova(s) de ${ult.itens}` : 'nenhum importado')}
    </div>
    ${F.tabela(['Data', 'Descrição', 'Valor', 'Situação', ''], lista.map(linha), daConta.length ? 'Nada neste filtro.' : 'Nenhum extrato importado nesta conta. Use "Importar OFX".')}`;
}

/** @type {null|{itens:any[], nome:string}} */
let lido = null;
function formImportar() {
  const c = contaAtual();
  if (!c) return;
  lido = null;
  F.abrirModal(
    'Importar extrato (OFX)',
    `<div class="lc-form">
      <label>Conta *<select id="fx-conta">${F.opcoesLista(
        F.G.contas.filter((/** @type {any} */ x) => x.ativo),
        c.id,
        '— escolha —'
      )}</select></label>
      <label>Arquivo .ofx *<input type="file" id="fx-arquivo" accept=".ofx,.OFX,application/x-ofx" data-acao-change="fnExtArquivo"></label>
      <div class="lc-largo" id="fx-previa"><p class="lc-dica">No internet banking, exporte o extrato em "OFX" (ou "Money/Quicken"). O arquivo é lido aqui: só data, valor e descrição de cada linha são gravados.</p></div>
    </div>`,
    async () => {
      if (!lido || !lido.itens.length) throw new Error('Escolha o arquivo OFX.');
      if (!F.campo('fx-conta')) throw new Error('Escolha a conta.');
      const r = await F.rpc('a1_fin_extrato_importar', {
        p_conta: F.campo('fx-conta'),
        p_arquivo: lido.nome,
        p_itens: lido.itens
      });
      F.G.filtro.contaExt = F.campo('fx-conta');
      F.aviso(`${r.novos} linha(s) nova(s)${r.repetidos ? `, ${r.repetidos} já importada(s)` : ''}.`);
    },
    'Importar'
  );
}
async function lerArquivo(/** @type {HTMLInputElement} */ el) {
  const previa = document.getElementById('fx-previa');
  const f = el.files && el.files[0];
  if (!previa || !f) return;
  lido = null;
  try {
    if (f.size > 5 * 1024 * 1024) throw new Error('Arquivo maior que 5 MB.');
    const r = lerOfx(decodificarOfx(await f.arrayBuffer()));
    if (!r.itens.length) throw new Error(ERROS_CONCILIACAO.extrato_vazio);
    if (r.itens.length > 5000) throw new Error(ERROS_CONCILIACAO.extrato_grande);
    lido = { itens: r.itens, nome: f.name.slice(0, 160) };
    const ent = r.itens.filter(i => i.valor > 0).reduce((s, i) => s + i.valor, 0);
    const sai = r.itens.filter(i => i.valor < 0).reduce((s, i) => s - i.valor, 0);
    previa.innerHTML = `<p><b>${esc(String(r.itens.length))}</b> transação(ões)${r.inicio ? ` de ${esc(F.data(r.inicio))} a ${esc(F.data(r.fim))}` : ''}${r.conta ? ` · conta ${esc(r.conta)}` : ''} · entradas ${esc(F.brl(ent))} · saídas ${esc(F.brl(sai))}</p>
      ${F.tabela(
        ['Data', 'Descrição', 'Valor'],
        r.itens
          .slice(0, 5)
          .map(
            i =>
              `<tr><td>${esc(F.data(i.data))}</td><td>${esc(i.descricao)}</td><td class="lc-num">${esc(F.brl(i.valor))}</td></tr>`
          )
      )}`;
  } catch (e) {
    previa.innerHTML = `<p class="lc-erro">${esc(/** @type {Error} */ (e).message)}</p>`;
  }
}

function conciliarAuto() {
  const c = contaAtual();
  if (!c) return;
  F.executar(async () => {
    const r = await F.rpc('a1_fin_extrato_conciliar_auto', { p_conta: c.id });
    F.aviso(
      r.conciliados
        ? `${r.conciliados} linha(s) conciliada(s).`
        : 'Nenhuma linha com um único par exato. Concilie uma a uma.'
    );
  }, '');
}

async function abrirItem(/** @type {string} */ id) {
  const i = F.G.extrato.find((/** @type {any} */ x) => x.id === id);
  if (!i) return;
  let sug = [];
  try {
    sug = await F.rpc('a1_fin_extrato_sugestoes', { p_item: id });
  } catch (e) {
    F.aviso(/** @type {Error} */ (e).message, 'erro');
    return;
  }
  const lista = Array.isArray(sug) ? sug : [];
  F.abrirModal(
    'Conciliar linha do extrato',
    `<p><b class="${i.valor < 0 ? 'fn-saida' : 'fn-entrada'}">${esc(F.brl(i.valor))}</b> em ${esc(F.data(i.data))} · ${esc(i.descricao || '')}</p>
    <h4>Sugestões</h4>
    ${F.tabela(
      ['Tipo', 'Descrição', 'Data', 'Valor', 'Distância', ''],
      lista.map(
        (
          /** @type {any} */ s
        ) => `<tr><td>${s.tipo === 'parcela' ? F.selo('info', 'Parcela') : F.selo(s.status === 'pago' ? 'ok' : 'alerta', s.status === 'pago' ? 'Já baixado' : 'Em aberto')}</td>
          <td>${esc(s.descricao)}</td><td>${esc(F.data(s.data))}</td><td class="lc-num">${esc(F.brl(s.valor))}</td>
          <td>${esc(String(s.dias))} dia(s)</td>
          <td class="lc-acoes"><button class="lc-btn lc-btn-p lc-btn-forte" data-acao="fnExtUsar" data-item="${esc(i.id)}" data-tipo="${esc(s.tipo)}" data-id="${esc(s.id)}">Usar este</button></td></tr>`
      ),
      'Nenhum lançamento ou parcela com este valor perto desta data.'
    )}
    <p class="lc-dica">Lançamento em aberto é baixado na data do extrato, nesta conta. Parcela da carteira é recebida com o valor do dia (correção e encargos incluídos). Sem par: crie o lançamento a partir da linha.</p>
    <div class="fn-ficha-acoes"><button type="button" class="lc-btn" data-acao="fnExtCriar" data-id="${esc(i.id)}">Criar lançamento desta linha</button></div>`,
    null
  );
  document.querySelector('.lc-modal')?.classList.add('fn-modal-largo');
}

function usarSugestao(/** @type {string} */ item, /** @type {string} */ tipo, /** @type {string} */ id) {
  F.executar(async () => {
    F.fecharModal();
    await F.rpc('a1_fin_extrato_conciliar', {
      p_item: item,
      p_lancamento: tipo === 'lancamento' ? id : null,
      p_parcela: tipo === 'parcela' ? id : null
    });
  }, 'Linha conciliada.');
}

function formCriar(/** @type {string} */ id) {
  const i = F.G.extrato.find((/** @type {any} */ x) => x.id === id);
  if (!i) return;
  const cats = F.G.categorias.filter(
    (/** @type {any} */ c) => c.ativo && c.tipo === (i.valor > 0 ? 'receita' : 'despesa')
  );
  F.abrirModal(
    i.valor > 0 ? 'Nova receita do extrato' : 'Nova despesa do extrato',
    `<div class="lc-form">
      <p class="lc-largo">${esc(F.brl(i.valor))} em ${esc(F.data(i.data))}: entra como ${i.valor > 0 ? 'recebido' : 'pago'} nesta data, nesta conta.</p>
      <label class="lc-largo">Descrição<input id="fx-desc" maxlength="200" value="${esc(i.descricao || '')}"></label>
      <label>Categoria<select id="fx-cat">${F.opcoesLista(cats, null, '— sem categoria —')}</select></label>
      <label>Centro de custo<select id="fx-centro">${F.opcoesLista(
        F.G.centros.filter((/** @type {any} */ c) => c.ativo),
        null,
        '— nenhum —'
      )}</select></label>
    </div>`,
    async () => {
      await F.rpc('a1_fin_extrato_criar_lancamento', {
        p_item: i.id,
        p_descricao: F.campo('fx-desc'),
        p_categoria: F.campo('fx-cat') || null,
        p_centro: F.campo('fx-centro') || null
      });
      F.aviso('Lançamento criado e conciliado.');
    },
    'Criar e conciliar'
  );
}

function marcar(/** @type {string} */ id, /** @type {string} */ acao) {
  if (
    acao === 'desfazer' &&
    !confirm(
      'Desfazer a conciliação? A linha volta a pendente. A baixa feita continua (estorne em A receber/A pagar se precisar); lançamento criado pelo extrato é apagado.'
    )
  )
    return;
  F.executar(
    () => F.rpc('a1_fin_extrato_marcar', { p_item: id, p_acao: acao }),
    acao === 'ignorar' ? 'Linha ignorada.' : 'Conciliação desfeita.'
  );
}
