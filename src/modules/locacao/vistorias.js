// ─── Locação: vistoria de entrada, saída e periódica ─────────────────────────
//
// COMO FUNCIONA
//   - Vistoria = cabeçalho (a1_lc_vistorias) + itens por cômodo
//     (a1_lc_vistoria_itens: cômodo, item, estado, observação, fotos).
//   - Enquanto rascunho, edita à vontade (o banco deixa gravar direto); ao
//     concluir (a1_lc_concluir_vistoria) trava para sempre: vira o laudo.
//   - Fotos vão para o bucket case-documents, na pasta do cliente
//     ({tenant}/locacao/vistorias/{vistoria}/...), que o Storage já isola por
//     cliente. A linha guarda só o caminho; a miniatura usa URL assinada.
//   - Saída: começa com os itens da entrada do mesmo contrato e mostra o
//     comparativo (o que piorou).
//   - Salvar os itens grava primeiro (upsert por id) e só depois apaga os que
//     saíram: se a gravação falhar, nada some.
import { A1 } from '../../shared/api/config.js';
import { esc } from '../../shared/utils/texto.js';
import { hojeISO } from '../../shared/utils/datas.js';
import { acoes } from '../../shared/ui/acoes.js';
import {
  G,
  $,
  data,
  imovel,
  contrato,
  idContrato,
  nomeImovel,
  selo,
  aviso,
  motivo,
  rpc,
  abrirModal,
  campo,
  opcoes,
  tabela,
  imprimir,
  recarregar
} from './base.js';

const TIPOS = /** @type {Record<string,string>} */ ({
  entrada: 'Entrada',
  saida: 'Saída',
  periodica: 'Periódica'
});
const ESTADOS = /** @type {Record<string,string>} */ ({
  novo: 'Novo',
  bom: 'Bom',
  regular: 'Regular',
  ruim: 'Ruim',
  inexistente: 'Inexistente'
});
const NOTA = /** @type {Record<string,number>} */ ({ novo: 4, bom: 3, regular: 2, ruim: 1, inexistente: 0 });
const BUCKET = 'case-documents';
// Roteiro padrão por cômodo.
export const ROTEIRO = /** @type {Record<string,string[]>} */ ({
  Sala: [
    'Piso',
    'Paredes e pintura',
    'Teto',
    'Portas e fechaduras',
    'Janelas e vidros',
    'Tomadas e interruptores',
    'Iluminação'
  ],
  Cozinha: [
    'Piso',
    'Paredes e revestimento',
    'Teto',
    'Pia e torneira',
    'Armários',
    'Tomadas e interruptores',
    'Janelas e vidros'
  ],
  Banheiro: [
    'Piso',
    'Revestimento',
    'Vaso sanitário',
    'Pia e torneira',
    'Chuveiro',
    'Box',
    'Portas e fechaduras'
  ],
  Quarto: [
    'Piso',
    'Paredes e pintura',
    'Teto',
    'Portas e fechaduras',
    'Janelas e vidros',
    'Armários',
    'Tomadas e interruptores'
  ],
  'Área de serviço': ['Piso', 'Tanque e torneira', 'Paredes', 'Instalações de gás e água'],
  Varanda: ['Piso', 'Guarda-corpo', 'Paredes e pintura'],
  Garagem: ['Piso', 'Portão', 'Iluminação'],
  'Área externa': ['Fachada', 'Muros', 'Portão', 'Jardim']
});
const PADRAO_NOVA = ['Sala', 'Cozinha', 'Banheiro', 'Quarto', 'Área de serviço'];

const V = { atual: /** @type {any} */ (null), itens: /** @type {any[]} */ ([]) };
const uuid = () =>
  globalThis.crypto && crypto.randomUUID
    ? crypto.randomUUID()
    : 'xxxxxxxx-xxxx-4xxx-8xxx-xxxxxxxxxxxx'.replace(/x/g, () => ((Math.random() * 16) | 0).toString(16));

async function lerItens(/** @type {string} */ vistoriaId) {
  const r = await A1.buscarTudo(
    `${A1.rest('a1_lc_vistoria_itens')}?select=*&vistoria_id=eq.${encodeURIComponent(vistoriaId)}&order=ordem.asc,id.asc`
  );
  return (r && r.linhas) || [];
}
/** A entrada concluída que serve de base para uma saída. */
function entradaDe(/** @type {any} */ v) {
  return (
    G.vistorias
      .filter(
        x =>
          x.id !== v.id &&
          x.tipo === 'entrada' &&
          x.status === 'concluida' &&
          x.imovel_id === v.imovel_id &&
          (!v.contrato_id || x.contrato_id === v.contrato_id) &&
          x.data <= v.data
      )
      .sort((a, b) => String(b.data).localeCompare(String(a.data)))[0] || null
  );
}

// ─── Lista (vista Vistorias) ────────────────────────────────────────────────
export function vistorias() {
  const q = G.filtro.busca;
  const l = G.vistorias.filter(v => !q || nomeImovel(imovel(v.imovel_id)).toLowerCase().includes(q));
  return tabela(
    ['Imóvel', 'Contrato', 'Tipo', 'Data', 'Responsável', 'Situação', ''],
    l.map(
      v => `<tr data-id="${esc(v.id)}">
      <td>${esc(nomeImovel(imovel(v.imovel_id)))}</td>
      <td class="lc-mono">${v.contrato_id ? esc(idContrato(contrato(v.contrato_id))) : '—'}</td>
      <td>${esc(TIPOS[v.tipo] || v.tipo)}</td>
      <td>${esc(data(v.data))}</td>
      <td>${esc(v.responsavel || '')}</td>
      <td>${v.status === 'concluida' ? selo('ok', 'Concluída') : selo('info', 'Rascunho')}</td>
      <td class="lc-acoes"><button class="lc-btn lc-btn-p" data-acao="lcVistAbrir" data-id="${esc(v.id)}">${v.status === 'concluida' ? 'Ver laudo' : 'Editar'}</button>${
        v.tipo === 'saida' && entradaDe(v)
          ? ` <button class="lc-btn lc-btn-p" data-acao="lcVistComparar" data-id="${esc(v.id)}">Comparar com a entrada</button>`
          : ''
      }</td></tr>`
    ),
    'Nenhuma vistoria. Faça a de entrada ao ativar um contrato e a de saída na entrega das chaves.'
  );
}

// ─── Ações ──────────────────────────────────────────────────────────────────
acoes({
  lcVistNova: el => novaVistoria(el.dataset.imovel || '', el.dataset.contrato || '', el.dataset.tipo || ''),
  lcVistImovel: () => opcoesContrato(),
  lcVistAbrir: el => abrirVistoria(el.dataset.id || ''),
  lcVistItemMais: () => {
    coletar();
    V.itens.push({ id: uuid(), comodo: ultimoComodo(), item: '', estado: 'bom', observacao: '', fotos: [] });
    desenharItens();
  },
  lcVistComodo: () => {
    const nome = campo('lv-comodo');
    if (!nome) return;
    coletar();
    (ROTEIRO[nome] || ['']).forEach(item =>
      V.itens.push({ id: uuid(), comodo: nome, item, estado: 'bom', observacao: '', fotos: [] })
    );
    desenharItens();
  },
  lcVistItemMenos: el => {
    coletar();
    V.itens = V.itens.filter(i => i.id !== el.dataset.id);
    desenharItens();
  },
  lcVistFoto: el => enviarFotos(/** @type {HTMLInputElement} */ (el)),
  lcVistFotoMenos: el => {
    coletar();
    const it = V.itens.find(i => i.id === el.dataset.id);
    if (it) it.fotos = it.fotos.filter((/** @type {string} */ f) => f !== el.dataset.foto);
    desenharItens();
  },
  lcVistConcluir: () => concluir(),
  lcVistImprimir: () => imprimir(laudo(V.atual, V.itens)),
  lcVistComparar: el => comparar(el.dataset.id || '')
});

const ultimoComodo = () => (V.itens.length ? V.itens[V.itens.length - 1].comodo : 'Sala');

function opcoesContrato() {
  const sel = /** @type {HTMLSelectElement|null} */ (document.getElementById('lv-contrato'));
  if (!sel) return;
  const im = campo('lv-imovel');
  const lista = G.contratos.filter(c => c.imovel_id === im && c.status !== 'rascunho');
  sel.innerHTML =
    '<option value="">— sem contrato —</option>' +
    lista
      .map(
        c =>
          `<option value="${esc(c.id)}"${c.status === 'ativo' ? ' selected' : ''}>${esc(idContrato(c))} · ${esc(c.status)}</option>`
      )
      .join('');
}

function novaVistoria(
  /** @type {string} */ imovelId,
  /** @type {string} */ contratoId,
  /** @type {string} */ tipo
) {
  abrirModal(
    'Nova vistoria',
    `<div class="lc-form">
      <label class="lc-largo">Imóvel *<select id="lv-imovel" data-acao-change="lcVistImovel"><option value="">— selecione —</option>${G.imoveis
        .map(
          i =>
            `<option value="${esc(i.id)}"${i.id === imovelId ? ' selected' : ''}>${esc(nomeImovel(i))}</option>`
        )
        .join('')}</select></label>
      <label class="lc-largo">Contrato<select id="lv-contrato"></select></label>
      <label>Tipo<select id="lv-tipo">${opcoes(TIPOS, TIPOS[tipo] ? tipo : 'entrada')}</select></label>
      <label>Data<input type="date" id="lv-data" value="${esc(hojeISO())}"></label>
      <label>Responsável<input id="lv-resp" maxlength="120" value="${esc((A1.user || {}).name || '')}"></label>
      <label class="lc-check lc-largo"><input type="checkbox" id="lv-roteiro" checked> Começar com o roteiro padrão (sala, cozinha, banheiro, quarto, área de serviço). Na saída, começa com os itens da entrada.</label>
    </div>`,
    async () => {
      const im = campo('lv-imovel');
      if (!im) throw new Error('Escolha o imóvel.');
      const i = imovel(im);
      const r = await fetch(A1.rest('a1_lc_vistorias'), {
        method: 'POST',
        headers: A1.returnHeaders(),
        body: JSON.stringify({
          tenant_id: (i && i.tenant_id) || (A1.user || {}).tenant_id,
          imovel_id: im,
          contrato_id: campo('lv-contrato') || null,
          tipo: campo('lv-tipo'),
          data: campo('lv-data') || hojeISO(),
          responsavel: campo('lv-resp') || null
        })
      });
      if (!r.ok) throw new Error(await motivo(r));
      const v = (await r.json())[0];
      let itens = /** @type {any[]} */ ([]);
      const base = v.tipo === 'saida' ? entradaDe(v) : null;
      if (base) {
        itens = (await lerItens(base.id)).map(x => ({
          id: uuid(),
          comodo: x.comodo,
          item: x.item,
          estado: x.estado,
          observacao: '',
          fotos: []
        }));
      } else if (/** @type {HTMLInputElement} */ ($('lv-roteiro')).checked) {
        PADRAO_NOVA.forEach(c =>
          ROTEIRO[c].forEach(item =>
            itens.push({ id: uuid(), comodo: c, item, estado: 'bom', observacao: '', fotos: [] })
          )
        );
      }
      if (itens.length) await gravarItens(v, itens);
      G.vistorias.unshift(v);
      await abrirVistoria(v.id, v);
      return 'manter';
    },
    'Criar e abrir'
  );
  opcoesContrato();
  if (contratoId) /** @type {HTMLSelectElement} */ ($('lv-contrato')).value = contratoId;
}

async function gravarItens(/** @type {any} */ v, /** @type {any[]} */ itens) {
  if (itens.length) {
    const r = await fetch(`${A1.rest('a1_lc_vistoria_itens')}?on_conflict=id`, {
      method: 'POST',
      headers: A1.headers({ Prefer: 'resolution=merge-duplicates,return=minimal' }),
      body: JSON.stringify(
        itens.map((x, n) => ({
          id: x.id,
          tenant_id: v.tenant_id,
          vistoria_id: v.id,
          ordem: n,
          comodo: x.comodo,
          item: x.item,
          estado: x.estado,
          observacao: x.observacao || null,
          fotos: x.fotos || []
        }))
      )
    });
    if (!r.ok) throw new Error(await motivo(r));
  }
  const ficam = itens.map(x => x.id).join(',');
  const d = await fetch(
    `${A1.rest('a1_lc_vistoria_itens')}?vistoria_id=eq.${encodeURIComponent(v.id)}` +
      (ficam ? `&id=not.in.(${ficam})` : ''),
    { method: 'DELETE', headers: A1.headers() }
  );
  if (!d.ok) throw new Error(await motivo(d));
}

export async function abrirVistoria(/** @type {string} */ id, /** @type {any} */ jaTenho = null) {
  const v = jaTenho || G.vistorias.find(x => x.id === id);
  if (!v) return;
  V.atual = v;
  V.itens = (await lerItens(v.id)).map(x => ({ ...x, fotos: Array.isArray(x.fotos) ? x.fotos : [] }));
  const aberta = v.status === 'rascunho';
  const titulo = `Vistoria de ${(TIPOS[v.tipo] || v.tipo).toLowerCase()} · ${nomeImovel(imovel(v.imovel_id))}`;
  abrirModal(
    titulo,
    `<div class="lc-form">
      <label>Data<input type="date" id="lv-e-data" value="${esc(v.data)}"${aberta ? '' : ' disabled'}></label>
      <label>Responsável<input id="lv-e-resp" maxlength="120" value="${esc(v.responsavel || '')}"${aberta ? '' : ' disabled'}></label>
      <label>Contrato<input value="${v.contrato_id ? esc(idContrato(contrato(v.contrato_id))) : '—'}" disabled></label>
      <label class="lc-largo">Observações gerais<textarea id="lv-e-obs" rows="2" maxlength="4000"${aberta ? '' : ' disabled'}>${esc(v.observacoes || '')}</textarea></label>
    </div>
    ${
      aberta
        ? `<div class="lc-vist-barra"><label>Adicionar cômodo <select id="lv-comodo">${[
            '',
            ...Object.keys(ROTEIRO)
          ]
            .map(c => `<option value="${esc(c)}">${esc(c || '— escolha —')}</option>`)
            .join('')}</select></label>
          <button type="button" class="lc-btn lc-btn-p" data-acao="lcVistComodo">+ Cômodo com roteiro</button>
          <button type="button" class="lc-btn lc-btn-p" data-acao="lcVistItemMais">+ Item</button></div>`
        : `<p class="lc-dica">Vistoria concluída em ${esc(data(v.concluida_em))}: este é o laudo e não muda mais.</p>`
    }
    <div id="lv-itens" class="lc-vist-itens"></div>
    <div class="lc-donos-pe">
      <button type="button" class="lc-btn lc-btn-p" data-acao="lcVistImprimir">Imprimir laudo</button>
      ${aberta ? '<button type="button" class="lc-btn lc-btn-p lc-btn-forte" data-acao="lcVistConcluir">Concluir vistoria</button>' : ''}
    </div>`,
    aberta
      ? async () => {
          await salvarVistoria();
          aviso('Vistoria salva.');
          return 'manter';
        }
      : null,
    'Salvar'
  );
  desenharItens();
}

/** Lê o que está na tela para V.itens (antes de redesenhar ou salvar). */
function coletar() {
  document.querySelectorAll('#lv-itens .lc-vi').forEach(l => {
    const it = V.itens.find(i => i.id === /** @type {HTMLElement} */ (l).dataset.id);
    if (!it) return;
    const q = (/** @type {string} */ s) => /** @type {HTMLInputElement} */ (l.querySelector(s));
    it.comodo = q('.lvi-comodo').value.trim();
    it.item = q('.lvi-item').value.trim();
    it.estado = q('.lvi-estado').value;
    it.observacao = q('.lvi-obs').value.trim();
  });
}

function desenharItens() {
  const alvo = document.getElementById('lv-itens');
  if (!alvo || !V.atual) return;
  const aberta = V.atual.status === 'rascunho';
  if (!V.itens.length) {
    alvo.innerHTML = `<p class="lc-vazio">${aberta ? 'Nenhum item ainda. Adicione um cômodo com o roteiro ou um item avulso.' : 'Sem itens.'}</p>`;
    return;
  }
  let comodoAnterior = '';
  alvo.innerHTML = V.itens
    .map(it => {
      const cab =
        it.comodo !== comodoAnterior ? `<h4 class="lc-vi-comodo">${esc(it.comodo || 'Sem cômodo')}</h4>` : '';
      comodoAnterior = it.comodo;
      const fotos = (it.fotos || [])
        .map(
          (/** @type {string} */ f) =>
            `<span class="lc-vi-foto"><img alt="Foto do item" data-foto="${esc(f)}">${
              aberta
                ? `<button type="button" data-acao="lcVistFotoMenos" data-id="${esc(it.id)}" data-foto="${esc(f)}" aria-label="Remover foto">×</button>`
                : ''
            }</span>`
        )
        .join('');
      const dis = aberta ? '' : ' disabled';
      return `${cab}<div class="lc-vi" data-id="${esc(it.id)}">
        <input class="lvi-comodo" maxlength="80" value="${esc(it.comodo)}" aria-label="Cômodo"${dis}>
        <input class="lvi-item" maxlength="120" value="${esc(it.item)}" placeholder="Item" aria-label="Item"${dis}>
        <select class="lvi-estado" aria-label="Estado"${dis}>${opcoes(ESTADOS, it.estado)}</select>
        <input class="lvi-obs" maxlength="1000" value="${esc(it.observacao || '')}" placeholder="Observação" aria-label="Observação"${dis}>
        ${
          aberta
            ? `<label class="lc-btn lc-btn-p lc-vi-anexo">Foto<input type="file" accept="image/jpeg,image/png" multiple hidden data-acao-change="lcVistFoto" data-id="${esc(it.id)}"></label>
               <button type="button" class="lc-btn lc-btn-p" data-acao="lcVistItemMenos" data-id="${esc(it.id)}" aria-label="Remover item">×</button>`
            : ''
        }
        <div class="lc-vi-fotos">${fotos}</div></div>`;
    })
    .join('');
  miniaturas(alvo);
}

async function miniaturas(/** @type {HTMLElement} */ alvo) {
  const imgs = [...alvo.querySelectorAll('img[data-foto]')];
  for (const img of imgs) {
    const url = await A1.storageSignedUrl(BUCKET, /** @type {HTMLElement} */ (img).dataset.foto || '', 600);
    if (url) /** @type {HTMLImageElement} */ (img).src = url;
  }
}

async function enviarFotos(/** @type {HTMLInputElement} */ el) {
  coletar();
  const it = V.itens.find(i => i.id === el.dataset.id);
  if (!it || !el.files) return;
  const tenant = V.atual.tenant_id;
  for (const f of [...el.files]) {
    if (!['image/jpeg', 'image/png'].includes(f.type)) {
      aviso('Use fotos JPG ou PNG.', 'erro');
      continue;
    }
    if (f.size > 8 * 1024 * 1024) {
      aviso('Foto acima de 8 MB.', 'erro');
      continue;
    }
    if ((it.fotos || []).length >= 12) {
      aviso('Até 12 fotos por item.', 'erro');
      break;
    }
    const caminho = `${tenant}/locacao/vistorias/${V.atual.id}/${uuid()}.${f.type === 'image/png' ? 'png' : 'jpg'}`;
    const ok = await A1.storageUpload(BUCKET, caminho, f);
    if (!ok) {
      aviso('Não foi possível enviar a foto agora.', 'erro');
      continue;
    }
    it.fotos = [...(it.fotos || []), caminho];
  }
  desenharItens();
  aviso('Foto anexada. Clique em Salvar para gravar.');
}

async function salvarVistoria() {
  coletar();
  const v = V.atual;
  if (V.itens.some(i => !i.comodo || !i.item)) throw new Error('Cada item precisa de cômodo e nome.');
  const r = await fetch(`${A1.rest('a1_lc_vistorias')}?id=eq.${encodeURIComponent(v.id)}`, {
    method: 'PATCH',
    headers: A1.returnHeaders(),
    body: JSON.stringify({
      data: campo('lv-e-data') || v.data,
      responsavel: campo('lv-e-resp') || null,
      observacoes: campo('lv-e-obs') || null,
      atualizado_em: new Date().toISOString()
    })
  });
  if (!r.ok) throw new Error(await motivo(r));
  const linhas = await r.json().catch(() => []);
  if (!Array.isArray(linhas) || !linhas.length)
    throw new Error('Esta vistoria já foi concluída e não muda mais.');
  V.atual = { ...v, ...linhas[0] };
  await gravarItens(V.atual, V.itens);
}

async function concluir() {
  if (G.ocupado) return;
  if (!confirm('Concluir a vistoria? Depois de concluída ela vira o laudo e não pode mais ser alterada.'))
    return;
  G.ocupado = true;
  try {
    await salvarVistoria();
    await rpc('a1_lc_concluir_vistoria', { p_vistoria: V.atual.id });
    aviso('Vistoria concluída.');
    G.ocupado = false;
    await recarregar();
    await abrirVistoria(V.atual.id);
  } catch (e) {
    $('lc-modal-erro').textContent = /** @type {Error} */ (e).message;
    $('lc-modal-erro').hidden = false;
  } finally {
    G.ocupado = false;
  }
}

function laudo(/** @type {any} */ v, /** @type {any[]} */ itens) {
  const c = v.contrato_id ? contrato(v.contrato_id) : null;
  let comodo = '';
  return `<article class="lc-doc">
    <h1>Laudo de vistoria de ${esc((TIPOS[v.tipo] || v.tipo).toLowerCase())}</h1>
    <p><b>Imóvel:</b> ${esc(nomeImovel(imovel(v.imovel_id)))}${c ? `<br><b>Contrato:</b> ${esc(idContrato(c))}` : ''}<br>
       <b>Data:</b> ${esc(data(v.data))}${v.responsavel ? `<br><b>Responsável:</b> ${esc(v.responsavel)}` : ''}<br>
       <b>Situação:</b> ${v.status === 'concluida' ? `concluída em ${esc(data(v.concluida_em))}` : 'rascunho'}</p>
    ${v.observacoes ? `<p>${esc(v.observacoes)}</p>` : ''}
    <table class="lc-doc-tbl"><thead><tr><th>Item</th><th>Estado</th><th>Observação</th><th>Fotos</th></tr></thead><tbody>
    ${itens
      .map(it => {
        const cab = it.comodo !== comodo ? `<tr><th colspan="4">${esc(it.comodo)}</th></tr>` : '';
        comodo = it.comodo;
        return `${cab}<tr><td>${esc(it.item)}</td><td>${esc(ESTADOS[it.estado] || it.estado)}</td><td>${esc(it.observacao || '')}</td><td>${esc(String((it.fotos || []).length))}</td></tr>`;
      })
      .join('')}
    </tbody></table>
    <p><br>________________________________________<br>Responsável pela vistoria</p>
    <p>________________________________________<br>Locatário</p>
  </article>`;
}

async function comparar(/** @type {string} */ id) {
  const saida = G.vistorias.find(x => x.id === id);
  const entrada = saida && entradaDe(saida);
  if (!saida || !entrada) return;
  const [a, b] = await Promise.all([lerItens(entrada.id), lerItens(saida.id)]);
  const chave = (/** @type {any} */ x) => `${x.comodo}\u0000${x.item}`.toLowerCase();
  const daEntrada = new Map(a.map(x => [chave(x), x]));
  const linhas = b.map(x => {
    const e = daEntrada.get(chave(x));
    const piorou = e && NOTA[x.estado] < NOTA[e.estado];
    return `<tr class="${piorou ? 'lc-piorou' : ''}"><td>${esc(x.comodo)}</td><td>${esc(x.item)}</td>
      <td>${e ? esc(ESTADOS[e.estado]) : '—'}</td><td>${esc(ESTADOS[x.estado])}</td>
      <td>${piorou ? selo('erro', 'Piorou') : e ? '' : selo('info', 'Novo item')}</td><td>${esc(x.observacao || '')}</td></tr>`;
  });
  const piores = b.filter(x => {
    const e = daEntrada.get(chave(x));
    return e && NOTA[x.estado] < NOTA[e.estado];
  }).length;
  const html = `<article class="lc-doc"><h1>Comparativo de vistorias</h1>
    <p><b>Imóvel:</b> ${esc(nomeImovel(imovel(saida.imovel_id)))}<br><b>Entrada:</b> ${esc(data(entrada.data))} · <b>Saída:</b> ${esc(data(saida.data))}<br>
    <b>${esc(String(piores))}</b> item(ns) em estado pior que na entrada.</p>
    <table class="lc-doc-tbl"><thead><tr><th>Cômodo</th><th>Item</th><th>Entrada</th><th>Saída</th><th></th><th>Observação da saída</th></tr></thead>
    <tbody>${linhas.join('')}</tbody></table></article>`;
  abrirModal(
    'Comparativo entrada × saída',
    `<div class="lc-doc-previa">${html}</div>`,
    async () => {
      imprimir(html);
      return 'manter';
    },
    'Imprimir / salvar PDF'
  );
}
