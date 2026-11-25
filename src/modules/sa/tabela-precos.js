// @ts-check
// ─── Superadmin › Planos: a tabela de preços ─────────────────────────────────
//
// O PEDIDO DO DONO
//   "coloque toda essa tabela nos Planos, do superadmin" (a tabela de preços
//   2026: planos por quantidade de usuários, preço de cada módulo e pacotes).
//
// DE ONDE VEM
//   - Planos por usuários: a1_plans com tabela = '2026'. São eles que aparecem
//     ao cadastrar ou trocar o plano de um cliente.
//   - Módulos, pacotes e usuário adicional: a1_precos (só a chave de serviço;
//     o superadmin passa pela função sa-proxy).
//   - Planos antigos (tabela vazia): só leitura, com quantos clientes usam cada
//     um. Nada aqui altera plano ou limite de cliente.
//   Ver database/migrations/2026-11-25_tabela_de_precos.sql.
import { esc } from '../../shared/utils/texto.js';
import { acoes } from '../../shared/ui/acoes.js';

/** @type {{saRest:(t:string)=>string, saHeaders:(e?:any)=>any, toast:(m:string,t?:string)=>void, clientes:()=>any[], aoSalvarPlano:()=>Promise<void>}|null} */
let D = null;
/** @type {any[]} */
let PLANOS = [];
/** @type {any[]} */
let PRECOS = [];

const brl = (/** @type {number} */ v) =>
  'R$ ' + Number(v || 0).toLocaleString('pt-BR', { minimumFractionDigits: 0, maximumFractionDigits: 2 });
// "1.500,50" (com vírgula: ponto é milhar) ou "1500.5" (sem vírgula: ponto é decimal)
const num = (/** @type {string} */ s) => {
  const t = String(s).trim();
  return Number(t.includes(',') ? t.replace(/\./g, '').replace(',', '.') : t);
};
const $ = (/** @type {string} */ id) => /** @type {HTMLElement} */ (document.getElementById(id));

acoes({
  precoSalvarPlano: el => salvarPlano(/** @type {HTMLElement} */ (el)),
  precoSalvarItem: el => salvarItem(/** @type {HTMLElement} */ (el)),
  precoCalcular: () => calcular()
});

/** Liga o módulo ao painel (chamar uma vez). */
export function precosConfigurar(/** @type {NonNullable<typeof D>} */ deps) {
  D = deps;
}

/** Os planos da tabela vigente, na ordem (para o cadastro de cliente). */
export function precosPlanosVigentes(/** @type {any[]} */ planos) {
  return (Array.isArray(planos) ? planos : [])
    .filter(p => p.tabela === '2026')
    .sort((a, b) => (a.ordem ?? 99) - (b.ordem ?? 99));
}

/** Carrega a1_precos e desenha a aba inteira. `planos` é o que loadPlans leu. */
export async function precosCarregar(/** @type {any[]} */ planos) {
  if (!D) return;
  PLANOS = Array.isArray(planos) ? planos : [];
  try {
    const r = await fetch(D.saRest('a1_precos') + '?order=tipo.asc,ordem.asc', { headers: D.saHeaders() });
    const dados = r.ok ? await r.json() : [];
    PRECOS = Array.isArray(dados) ? dados : [];
  } catch {
    PRECOS = [];
  }
  desenhar();
}

/** Redesenha com o que já foi lido (ex.: quando a lista de clientes chega). */
export function precosRedesenhar() {
  desenhar();
}

function desenhar() {
  const alvo = document.getElementById('precos-tabela');
  if (!alvo || !D) return;
  const vigentes = precosPlanosVigentes(PLANOS);
  const antigos = PLANOS.filter(p => p.tabela !== '2026');
  const modulos = PRECOS.filter(p => p.tipo === 'modulo');
  const pacotes = PRECOS.filter(p => p.tipo === 'pacote');
  const extra = PRECOS.find(p => p.tipo === 'usuario_extra');
  const clientes = D.clientes();
  const usam = (/** @type {string} */ k) => clientes.filter(c => c.plan_key === k).length;

  if (!vigentes.length && !PRECOS.length) {
    alvo.innerHTML = `<div class="panel pr-vazio">A tabela de preços ainda não foi instalada no banco
      (database/migrations/2026-11-25_tabela_de_precos.sql).</div>${tabelaAntigos(antigos, usam)}`;
    return;
  }

  alvo.innerHTML = `
  <div class="panel pr-bloco">
    <div class="pr-cab"><div><div class="section-title">Plano por quantidade de usuários</div>
      <p class="pr-sub">Valor mensal da plataforma. São os planos oferecidos ao cadastrar ou trocar o plano de um cliente.</p></div></div>
    <div class="tbl-wrap pr-tbl"><table>
      <thead><tr><th>Plano</th><th>Até (usuários)</th><th>Preço / mês</th><th>Por usuário</th><th>Clientes</th><th></th></tr></thead>
      <tbody>${vigentes
        .map(
          p => `<tr data-plano="${esc(p.key)}">
        <td><input class="pr-in pr-nome" data-campo="name" value="${esc(p.name)}" maxlength="60" aria-label="Nome do plano"></td>
        <td><input class="pr-in pr-num" data-campo="max_users" type="number" min="1" max="100000" value="${esc(String(p.max_users))}" aria-label="Limite de usuários"></td>
        <td><span class="pr-rs">R$</span><input class="pr-in pr-num" data-campo="price_brl" inputmode="decimal" value="${esc(String(Number(p.price_brl)))}" aria-label="Preço mensal"></td>
        <td class="pr-calc">${brl(Number(p.price_brl) / Math.max(1, Number(p.max_users)))}</td>
        <td>${usam(p.key)}</td>
        <td><button type="button" class="btn btn-sm" data-acao="precoSalvarPlano" data-key="${esc(p.key)}">Salvar</button></td>
      </tr>`
        )
        .join('')}</tbody></table></div>
    ${
      extra
        ? `<div class="pr-extra" data-item="${esc(extra.chave)}"><span>Acima de 100 usuários: maior plano +</span>
        <span class="pr-rs">R$</span><input class="pr-in pr-num" data-campo="preco_brl" inputmode="decimal" value="${esc(String(Number(extra.preco_brl)))}" aria-label="Preço do usuário adicional">
        <span>por usuário adicional / mês</span>
        <button type="button" class="btn btn-sm" data-acao="precoSalvarItem" data-chave="${esc(extra.chave)}">Salvar</button></div>`
        : ''
    }
  </div>

  <div class="panel pr-bloco">
    <div class="pr-cab"><div><div class="section-title">Módulos</div>
      <p class="pr-sub">Valor mensal de cada módulo, somado ao plano de usuários. "Em breve" aparece na tabela para reserva.</p></div></div>
    <div class="tbl-wrap pr-tbl"><table>
      <thead><tr><th>Módulo</th><th>Descrição</th><th>Situação</th><th>Preço / mês</th><th></th></tr></thead>
      <tbody>${modulos
        .map(
          m => `<tr data-item="${esc(m.chave)}">
        <td><input class="pr-in pr-nome" data-campo="nome" value="${esc(m.nome)}" maxlength="80" aria-label="Nome do módulo">
          ${m.modulo_key ? `<div class="pr-chave mono">${esc(m.modulo_key)}</div>` : ''}</td>
        <td><textarea class="pr-in pr-desc" data-campo="descricao" maxlength="400" rows="2" aria-label="Descrição">${esc(m.descricao || '')}</textarea></td>
        <td><select class="pr-in" data-campo="status" aria-label="Situação">
          <option value="disponivel"${m.status === 'disponivel' ? ' selected' : ''}>Disponível</option>
          <option value="em_breve"${m.status === 'em_breve' ? ' selected' : ''}>Em breve</option></select></td>
        <td><span class="pr-rs">R$</span><input class="pr-in pr-num" data-campo="preco_brl" inputmode="decimal" value="${esc(String(Number(m.preco_brl)))}" aria-label="Preço mensal"></td>
        <td><button type="button" class="btn btn-sm" data-acao="precoSalvarItem" data-chave="${esc(m.chave)}">Salvar</button></td>
      </tr>`
        )
        .join('')}</tbody></table></div>
  </div>

  <div class="panel pr-bloco">
    <div class="pr-cab"><div><div class="section-title">Pacotes com desconto</div>
      <p class="pr-sub">O preço cheio é a soma atual dos módulos do pacote.</p></div></div>
    <div class="tbl-wrap pr-tbl"><table>
      <thead><tr><th>Pacote</th><th>Módulos</th><th>Preço cheio</th><th>Preço do pacote</th><th>Desconto</th><th></th></tr></thead>
      <tbody>${pacotes
        .map(p => {
          const cheio = (p.modulos || []).reduce(
            (/** @type {number} */ s, /** @type {string} */ k) =>
              s + Number((modulos.find(m => m.chave === k) || {}).preco_brl || 0),
            0
          );
          const desc = cheio ? Math.round((1 - Number(p.preco_brl) / cheio) * 100) : 0;
          return `<tr data-item="${esc(p.chave)}">
        <td><input class="pr-in pr-nome" data-campo="nome" value="${esc(p.nome)}" maxlength="80" aria-label="Nome do pacote"></td>
        <td class="pr-lista">${(p.modulos || []).map((/** @type {string} */ k) => esc((modulos.find(m => m.chave === k) || {}).nome || k)).join(', ')}</td>
        <td class="pr-calc">${brl(cheio)}</td>
        <td><span class="pr-rs">R$</span><input class="pr-in pr-num" data-campo="preco_brl" inputmode="decimal" value="${esc(String(Number(p.preco_brl)))}" aria-label="Preço do pacote"></td>
        <td class="pr-calc">${desc > 0 ? `${desc}%` : '—'}</td>
        <td><button type="button" class="btn btn-sm" data-acao="precoSalvarItem" data-chave="${esc(p.chave)}">Salvar</button></td>
      </tr>`;
        })
        .join('')}</tbody></table></div>
  </div>

  <div class="panel pr-bloco">
    <div class="pr-cab"><div><div class="section-title">Calculadora</div>
      <p class="pr-sub">Plano de usuários + módulos escolhidos.</p></div></div>
    <div class="pr-calcula">
      <label>Usuários <input id="pr-c-usuarios" class="pr-in pr-num" type="number" min="1" value="15" data-acao-input="precoCalcular"></label>
      <div class="pr-mods">${modulos
        .map(
          m =>
            `<label><input type="checkbox" value="${esc(m.chave)}" data-acao-change="precoCalcular"${m.status !== 'disponivel' ? ' disabled' : ''}> ${esc(m.nome)}</label>`
        )
        .join('')}</div>
      <div class="pr-total" id="pr-c-total" role="status"></div>
    </div>
  </div>

  ${tabelaAntigos(antigos, usam)}`;
  calcular();
}

function tabelaAntigos(/** @type {any[]} */ antigos, /** @type {(k:string)=>number} */ usam) {
  if (!antigos.length) return '';
  return `<div class="panel pr-bloco">
    <div class="pr-cab"><div><div class="section-title">Planos anteriores</div>
      <p class="pr-sub">Da tabela antiga. Continuam valendo para os clientes que já estão neles; não são mais oferecidos no cadastro.</p></div></div>
    <div class="tbl-wrap pr-tbl"><table>
      <thead><tr><th>Key</th><th>Nome</th><th>Usuários</th><th>Preço / mês</th><th>Clientes</th></tr></thead>
      <tbody>${antigos
        .map(
          p => `<tr><td><span class="mono">${esc(p.key)}</span></td><td>${esc(p.name)}</td><td>${esc(String(p.max_users))}</td>
        <td>${Number(p.price_brl) > 0 ? brl(Number(p.price_brl)) : 'Gratuito'}</td><td>${usam(p.key)}</td></tr>`
        )
        .join('')}</tbody></table></div></div>`;
}

/** Valor mensal para N usuários e os módulos marcados. */
function calcular() {
  const total = document.getElementById('pr-c-total');
  if (!total) return;
  const n = Math.max(1, Number(/** @type {HTMLInputElement} */ ($('pr-c-usuarios')).value) || 1);
  const vigentes = precosPlanosVigentes(PLANOS);
  const extra = Number((PRECOS.find(p => p.tipo === 'usuario_extra') || {}).preco_brl || 0);
  const plano = vigentes.find(p => n <= Number(p.max_users));
  const maior = vigentes[vigentes.length - 1];
  let base = 0;
  let rotulo = '';
  if (plano) {
    base = Number(plano.price_brl);
    rotulo = plano.name;
  } else if (maior) {
    base = Number(maior.price_brl) + (n - Number(maior.max_users)) * extra;
    rotulo = `${maior.name} + ${n - Number(maior.max_users)} adicionais`;
  }
  const marcados = [...document.querySelectorAll('.pr-mods input:checked')].map(
    i => /** @type {HTMLInputElement} */ (i).value
  );
  const mods = PRECOS.filter(p => p.tipo === 'modulo' && marcados.includes(p.chave));
  const soma = mods.reduce((s, m) => s + Number(m.preco_brl), 0);
  total.innerHTML = `<span>${esc(rotulo)} ${brl(base)}${mods.length ? ` + módulos ${brl(soma)}` : ''}</span><b>${brl(base + soma)} <small>/ mês</small></b>`;
}

async function salvarPlano(/** @type {HTMLElement} */ botao) {
  if (!D) return;
  const key = botao.dataset.key || '';
  const linha = /** @type {HTMLElement} */ (botao.closest('[data-plano]'));
  const campo = (/** @type {string} */ c) =>
    /** @type {HTMLInputElement} */ (linha.querySelector(`[data-campo="${c}"]`)).value.trim();
  const name = campo('name');
  const max = Number(campo('max_users'));
  const preco = num(campo('price_brl'));
  if (!name || !Number.isInteger(max) || max < 1 || !Number.isFinite(preco) || preco < 0) {
    D.toast('Confira nome, limite de usuários e preço.', 'error');
    return;
  }
  botao.setAttribute('disabled', '');
  try {
    // Só plano da tabela 2026: o filtro impede mexer num plano antigo em uso.
    const r = await fetch(`${D.saRest('a1_plans')}?key=eq.${encodeURIComponent(key)}&tabela=eq.2026`, {
      method: 'PATCH',
      headers: D.saHeaders({ Prefer: 'return=representation' }),
      body: JSON.stringify({ name, max_users: max, price_brl: preco })
    });
    const linhas = r.ok ? await r.json() : [];
    if (!Array.isArray(linhas) || !linhas.length) throw new Error();
    D.toast('Plano salvo.', 'success');
    await D.aoSalvarPlano();
  } catch {
    D.toast('Não foi possível salvar o plano.', 'error');
  } finally {
    botao.removeAttribute('disabled');
  }
}

async function salvarItem(/** @type {HTMLElement} */ botao) {
  if (!D) return;
  const chave = botao.dataset.chave || '';
  const linha = /** @type {HTMLElement} */ (botao.closest('[data-item]'));
  const valor = (/** @type {string} */ c) => {
    const el = /** @type {HTMLInputElement|null} */ (linha.querySelector(`[data-campo="${c}"]`));
    return el ? el.value.trim() : null;
  };
  const corpo = /** @type {Record<string, any>} */ ({ atualizado_em: new Date().toISOString() });
  const preco = num(valor('preco_brl') || '');
  if (!Number.isFinite(preco) || preco < 0) {
    D.toast('Preço inválido.', 'error');
    return;
  }
  corpo.preco_brl = preco;
  const nome = valor('nome');
  if (nome !== null) {
    if (!nome) {
      D.toast('Informe o nome.', 'error');
      return;
    }
    corpo.nome = nome;
  }
  const descricao = valor('descricao');
  if (descricao !== null) corpo.descricao = descricao || null;
  const status = valor('status');
  if (status !== null) corpo.status = status === 'em_breve' ? 'em_breve' : 'disponivel';
  botao.setAttribute('disabled', '');
  try {
    const r = await fetch(`${D.saRest('a1_precos')}?chave=eq.${encodeURIComponent(chave)}`, {
      method: 'PATCH',
      headers: D.saHeaders({ Prefer: 'return=representation' }),
      body: JSON.stringify(corpo)
    });
    const linhas = r.ok ? await r.json() : [];
    if (!Array.isArray(linhas) || !linhas.length) throw new Error();
    const i = PRECOS.findIndex(p => p.chave === chave);
    if (i >= 0) PRECOS[i] = linhas[0];
    D.toast('Salvo.', 'success');
    desenhar();
  } catch {
    D.toast('Não foi possível salvar.', 'error');
  } finally {
    botao.removeAttribute('disabled');
  }
}
