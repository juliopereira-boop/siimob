// @ts-check
// ─── Superadmin › Site ───────────────────────────────────────────────────────
//
// Onde o superadmin monta o site público: a página /links (banners, botões,
// separadores e o texto do topo), os canais de contato (que aparecem em
// /contato, /links e no rodapé) e os artigos de /blog.
//
// Escreve com a chave de serviço, como o Mural de Avisos: as tabelas do site
// (2026-11-12_site_links_blog.sql) não têm política de escrita para a chave
// pública. As imagens vão para o bucket público "site".
import { esc } from '../../shared/utils/texto.js';
import { acoes } from '../../shared/ui/acoes.js';
import { ICONES } from './marca.js';
import { markdown, minutosDeLeitura, slugDe } from './markdown.js';

/** @type {{url:()=>string, key:()=>string, toast:(m:string,t?:string)=>void}} */
const SA = { url: () => '', key: () => '', toast: () => {} };

/** @type {{vista:string, config:any, links:any[], posts:any[], editLink:any, editPost:any, slugManual:boolean, aba:string}} */
const ST = {
  vista: 'links',
  config: null,
  links: [],
  posts: [],
  editLink: null,
  editPost: null,
  slugManual: false,
  aba: 'escrever'
};

const TIPOS = {
  banner: ['Banner', 'Imagem clicável: campanha, oferta, novidade.'],
  destaque: ['Botão de destaque', 'O chamado principal, em branco.'],
  link: ['Botão', 'Um link comum.'],
  secao: ['Título de seção', 'Separa grupos de botões.']
};
const CATEGORIAS = ['Dicas', 'Estratégia', 'Gestão de equipe', 'Produto', 'Notícias'];
const REDES = [
  ['instagram', 'Instagram', 'https://instagram.com/siimob'],
  ['linkedin', 'LinkedIn', 'https://linkedin.com/company/siimob'],
  ['youtube', 'YouTube', 'https://youtube.com/@siimob'],
  ['facebook', 'Facebook', 'https://facebook.com/siimob'],
  ['tiktok', 'TikTok', 'https://tiktok.com/@siimob']
];

acoes({
  stVista: el => trocarVista(el.dataset.v || 'links'),
  stSalvarTopo: () => salvarConfig(['links_titulo', 'links_frase'], 'Topo da página salvo'),
  stSalvarCanais: () => salvarCanais(),
  stNovoLink: () => abrirLink(null),
  stEditarLink: el => abrirLink(el.dataset.id || null),
  stLigarLink: el => ligarLink(el.dataset.id || ''),
  stMoverLink: el => moverLink(el.dataset.id || '', Number(el.dataset.d)),
  stExcluirLink: el => excluirLink(el.dataset.id || ''),
  stTipoLink: () => pintarCamposLink(),
  stAtalhoUrl: el => {
    const i = /** @type {HTMLInputElement} */ (document.getElementById('stl-url'));
    i.value = el.dataset.url || '';
  },
  stSubirImagemLink: el =>
    subir(/** @type {HTMLInputElement} */ (el), 'links', url => {
      /** @type {HTMLInputElement} */ (document.getElementById('stl-imagem')).value = url;
      previaImagem('stl-imagem', 'stl-prev');
    }),
  stPreviaImagemLink: () => previaImagem('stl-imagem', 'stl-prev'),
  stSalvarLink: () => salvarLink(),
  stFechar: el => fechar(el.dataset.id || ''),
  stNovoPost: () => abrirPost(null),
  stEditarPost: el => abrirPost(el.dataset.id || null),
  stPublicarPost: el => alternarPost(el.dataset.id || ''),
  stExcluirPost: el => excluirPost(el.dataset.id || ''),
  stTituloPost: () => {
    if (ST.slugManual) return;
    const t = /** @type {HTMLInputElement} */ (document.getElementById('stp-titulo')).value;
    /** @type {HTMLInputElement} */ (document.getElementById('stp-slug')).value = slugDe(t);
    pintarEndereco();
  },
  stSlugPost: el => {
    ST.slugManual = true;
    const i = /** @type {HTMLInputElement} */ (el);
    i.value = slugDe(i.value);
    pintarEndereco();
  },
  stResumoPost: () => contarResumo(),
  stSubirCapa: el =>
    subir(/** @type {HTMLInputElement} */ (el), 'blog', url => {
      /** @type {HTMLInputElement} */ (document.getElementById('stp-capa')).value = url;
      previaImagem('stp-capa', 'stp-capa-prev');
    }),
  stPreviaCapa: () => previaImagem('stp-capa', 'stp-capa-prev'),
  stFerramenta: el => ferramenta(el.dataset.f || ''),
  stSubirImagemTexto: el =>
    subir(/** @type {HTMLInputElement} */ (el), 'blog', url =>
      inserir(`\n\n![Descreva a imagem](${url})\n\n`)
    ),
  stAbaPost: el => trocarAba(el.dataset.a || 'escrever'),
  stSalvarPost: el => salvarPost(el.dataset.publicar === 'true')
});

// ─── Infra ───────────────────────────────────────────────────────────────────
const H = (/** @type {Record<string,string>=} */ extra) => ({
  'Content-Type': 'application/json',
  apikey: SA.key(),
  Authorization: `Bearer ${SA.key()}`,
  ...(extra || {})
});
const rest = (/** @type {string} */ t) => `${SA.url()}/rest/v1/${t}`;
const $ = (/** @type {string} */ id) => /** @type {HTMLElement} */ (document.getElementById(id));
const val = (/** @type {string} */ id) => {
  const el = /** @type {HTMLInputElement|null} */ (document.getElementById(id));
  return el ? el.value.trim() : '';
};
async function pedir(/** @type {string} */ url, /** @type {RequestInit=} */ o) {
  const r = await fetch(url, o);
  if (!r.ok) {
    const e = await r.json().catch(() => ({}));
    const msg = String(e.message || e.error || 'HTTP ' + r.status);
    throw new Error(
      /does not exist|relation|schema cache/i.test(msg)
        ? 'As tabelas do site ainda não existem. Rode database/migrations/2026-11-12_site_links_blog.sql no Supabase.'
        : /a1_site_links_url_chk/.test(msg)
          ? 'O endereço precisa começar com https://, / (página do site), mailto: ou tel:.'
          : /a1_site_links_banner_chk/.test(msg)
            ? 'Banner precisa de imagem.'
            : /slug|duplicate/i.test(msg)
              ? 'Já existe um artigo com esse endereço. Troque o endereço.'
              : msg
    );
  }
  return r.status === 204 ? null : r.json().catch(() => null);
}
function abrir(/** @type {string} */ id) {
  $(id).classList.remove('hidden');
}
function fechar(/** @type {string} */ id) {
  document.getElementById(id)?.classList.add('hidden');
}
function erroModal(/** @type {string} */ id, /** @type {string} */ msg) {
  const el = $(id);
  el.textContent = msg;
  el.hidden = !msg;
}
const quando = (/** @type {any} */ iso) =>
  iso ? new Date(iso).toLocaleString('pt-BR', { dateStyle: 'short', timeStyle: 'short' }) : '';
/** datetime-local <-> ISO, no fuso de quem está editando. */
const paraCampo = (/** @type {any} */ iso) => {
  if (!iso) return '';
  const d = new Date(iso);
  return new Date(d.getTime() - d.getTimezoneOffset() * 60000).toISOString().slice(0, 16);
};
const doCampo = (/** @type {string} */ v) => (v ? new Date(v).toISOString() : null);

/** Envia uma imagem para o bucket público "site" e devolve o endereço. */
async function subir(
  /** @type {HTMLInputElement} */ input,
  /** @type {string} */ pasta,
  /** @type {(u:string)=>void} */ pronto
) {
  const arq = input.files && input.files[0];
  if (!arq) return;
  if (!/^image\/(png|jpeg|webp|gif)$/.test(arq.type)) {
    SA.toast('Envie uma imagem PNG, JPG, WebP ou GIF.', 'error');
    input.value = '';
    return;
  }
  if (arq.size > 5 * 1024 * 1024) {
    SA.toast(`Imagem grande demais (${(arq.size / 1048576).toFixed(1)} MB). O limite é 5 MB.`, 'error');
    input.value = '';
    return;
  }
  const nome = `${pasta}/${Date.now()}-${arq.name.toLowerCase().replace(/[^a-z0-9.]+/g, '-')}`;
  try {
    const r = await fetch(`${SA.url()}/storage/v1/object/site/${nome}`, {
      method: 'POST',
      headers: {
        apikey: SA.key(),
        Authorization: `Bearer ${SA.key()}`,
        'Content-Type': arq.type,
        'x-upsert': 'true'
      },
      body: arq
    });
    if (!r.ok) {
      const t = await r.text().catch(() => '');
      throw new Error(
        /Bucket not found/i.test(t) ? 'o bucket "site" não existe (rode o SQL do site)' : 'HTTP ' + r.status
      );
    }
    pronto(`${SA.url()}/storage/v1/object/public/site/${nome}`);
    SA.toast('Imagem enviada', 'success');
  } catch (e) {
    SA.toast('Não consegui enviar a imagem: ' + /** @type {Error} */ (e).message, 'error');
  } finally {
    input.value = '';
  }
}
function previaImagem(/** @type {string} */ campo, /** @type {string} */ alvo) {
  const u = val(campo);
  $(alvo).innerHTML = /^https?:\/\/|^\//.test(u) ? `<img src="${esc(u)}" alt="">` : '';
}

// ─── Montagem ────────────────────────────────────────────────────────────────
/** Chamado uma vez pelo superadmin, com o acesso dele. */
export function siteAdminMontar(/** @type {typeof SA} */ f) {
  Object.assign(SA, f);
  const div = document.getElementById('satab-site');
  if (!div || div.dataset.montado) return;
  div.dataset.montado = '1';
  div.innerHTML = `
    <div class="st-cab">
      <div>
        <div class="section-title">Site</div>
        <div class="st-sub">O que aparece em siimob.com.br/links, /contato e /blog. Muda no ar assim que você salva.</div>
      </div>
      <div class="st-seg" role="tablist">
        <button class="on" data-acao="stVista" data-v="links" role="tab">Página de links</button>
        <button data-acao="stVista" data-v="canais" role="tab">Canais de contato</button>
        <button data-acao="stVista" data-v="blog" role="tab">Blog</button>
      </div>
    </div>
    <div id="st-corpo"><div class="st-vazio">Carregando…</div></div>`;
  document.body.insertAdjacentHTML('beforeend', modais());
}

/** Abre a aba (recarrega do banco). */
export async function siteAdminAbrir() {
  try {
    const [cfg, links, posts] = await Promise.all([
      pedir(`${rest('a1_site_config')}?id=eq.1&select=*`, { headers: H() }),
      pedir(`${rest('a1_site_links')}?select=*&order=ordem.asc,criado_em.asc`, { headers: H() }),
      pedir(
        `${rest('a1_blog_posts')}?select=id,slug,titulo,resumo,categoria,autor,capa_url,destaque,publicado,publicado_em,tempo_leitura,atualizado_em&order=criado_em.desc`,
        { headers: H() }
      )
    ]);
    ST.config = (cfg && cfg[0]) || {};
    ST.links = links || [];
    ST.posts = posts || [];
    pintar();
  } catch (e) {
    $('st-corpo').innerHTML = `<div class="st-erro">${esc(/** @type {Error} */ (e).message)}</div>`;
  }
}

function trocarVista(/** @type {string} */ v) {
  ST.vista = v;
  document
    .querySelectorAll('.st-seg button')
    .forEach(b => b.classList.toggle('on', /** @type {HTMLElement} */ (b).dataset.v === v));
  pintar();
}

function pintar() {
  if (!ST.config) return;
  const c = $('st-corpo');
  c.innerHTML = ST.vista === 'canais' ? vistaCanais() : ST.vista === 'blog' ? vistaBlog() : vistaLinks();
}

// ─── Página de links ─────────────────────────────────────────────────────────
function situacaoLink(/** @type {any} */ l) {
  const agora = Date.now();
  if (!l.ativo) return ['Desligado', 'st-st-off'];
  if (l.inicio_em && new Date(l.inicio_em).getTime() > agora) return ['Agendado', 'st-st-agenda'];
  if (l.fim_em && new Date(l.fim_em).getTime() <= agora) return ['Encerrado', 'st-st-off'];
  return ['No ar', 'st-st-on'];
}

function vistaLinks() {
  const c = ST.config;
  const linhas = ST.links
    .map((l, i) => {
      const [sit, cls] = situacaoLink(l);
      const ic = l.icone && ICONES[l.icone] ? ICONES[l.icone].svg : '';
      return `<tr>
        <td class="st-ordem">
          <button class="st-mini" data-acao="stMoverLink" data-id="${esc(l.id)}" data-d="-1" ${i === 0 ? 'disabled' : ''} aria-label="Subir">↑</button>
          <button class="st-mini" data-acao="stMoverLink" data-id="${esc(l.id)}" data-d="1" ${i === ST.links.length - 1 ? 'disabled' : ''} aria-label="Descer">↓</button>
        </td>
        <td>
          <div class="st-item">
            ${l.tipo === 'banner' && l.imagem_url ? `<img class="st-thumb" src="${esc(l.imagem_url)}" alt="">` : `<span class="st-ic">${ic}</span>`}
            <div><b>${esc(l.titulo)}</b>
              <small>${esc(TIPOS[/** @type {keyof typeof TIPOS} */ (l.tipo)]?.[0] || l.tipo)}${l.url ? ' · ' + esc(l.url) : ''}</small></div>
          </div>
        </td>
        <td><span class="st-st ${cls}">${sit}</span>${l.fim_em ? `<small class="st-quando">até ${esc(quando(l.fim_em))}</small>` : ''}</td>
        <td class="st-num">${l.tipo === 'secao' ? '—' : Number(l.cliques || 0).toLocaleString('pt-BR')}</td>
        <td class="st-acoes">
          <button class="btn btn-ghost btn-sm" data-acao="stEditarLink" data-id="${esc(l.id)}">Editar</button>
          <button class="btn btn-ghost btn-sm" data-acao="stLigarLink" data-id="${esc(l.id)}">${l.ativo ? 'Desligar' : 'Ligar'}</button>
          <button class="btn btn-ghost btn-sm st-perigo" data-acao="stExcluirLink" data-id="${esc(l.id)}">Excluir</button>
        </td>
      </tr>`;
    })
    .join('');
  return `
    <div class="st-grade2">
      <div class="panel st-card">
        <div class="section-hdr"><div class="section-title">Topo da página</div>
          <a class="btn btn-ghost btn-sm" href="/links" target="_blank" rel="noopener">Ver /links ↗</a></div>
        <div class="form-group"><label>Título</label><input id="st-links_titulo" maxlength="60" value="${esc(c.links_titulo || 'SIIMOB')}"></div>
        <div class="form-group st-mt"><label>Frase</label><textarea id="st-links_frase" rows="2" maxlength="160">${esc(c.links_frase || '')}</textarea></div>
        <div class="st-pe"><button class="btn btn-primary" data-acao="stSalvarTopo">Salvar topo</button></div>
        <p class="st-dica">As redes e o WhatsApp que aparecem no pé da página vêm de <b>Canais de contato</b>.</p>
      </div>
      <div class="panel st-card st-dicas">
        <div class="section-title">Como montar</div>
        <ul>
          <li><b>Banner</b>: imagem de 1200 × 560 px (ou mais alta, se quiser), até 5 MB. Pode ter início e fim.</li>
          <li><b>Botão de destaque</b>: use um só, para o chamado principal.</li>
          <li><b>Título de seção</b>: separa grupos, por exemplo "Redes" ou "Conteúdo".</li>
          <li>Os cliques de cada item contam sozinhos.</li>
        </ul>
      </div>
    </div>
    <div class="panel st-card">
      <div class="section-hdr"><div class="section-title">Itens da página (${ST.links.length})</div>
        <button class="btn btn-primary" data-acao="stNovoLink">+ Novo item</button></div>
      ${
        ST.links.length
          ? `<div class="st-tabela"><table><thead><tr><th></th><th>Item</th><th>Situação</th><th class="st-num">Cliques</th><th></th></tr></thead><tbody>${linhas}</tbody></table></div>`
          : '<div class="st-vazio">Nenhum item ainda. A página mostra Conheça o SIIMOB, Blog e Contato até você criar o primeiro.</div>'
      }
    </div>`;
}

function abrirLink(/** @type {string|null} */ id) {
  const l = id ? ST.links.find(x => x.id === id) : null;
  ST.editLink = l ? l.id : null;
  $('stl-titulo-modal').textContent = l ? 'Editar item' : 'Novo item';
  /** @type {NodeListOf<HTMLInputElement>} */ (document.querySelectorAll('input[name="stl-tipo"]')).forEach(
    r => {
      r.checked = r.value === ((l && l.tipo) || 'link');
    }
  );
  const set = (/** @type {string} */ i, /** @type {any} */ v) => {
    /** @type {HTMLInputElement} */ ($(i)).value = v == null ? '' : String(v);
  };
  set('stl-titulo', l && l.titulo);
  set('stl-subtitulo', l && l.subtitulo);
  set('stl-url', l && l.url);
  set('stl-icone', (l && l.icone) || '');
  set('stl-imagem', l && l.imagem_url);
  set('stl-inicio', paraCampo(l && l.inicio_em));
  set('stl-fim', paraCampo(l && l.fim_em));
  /** @type {HTMLInputElement} */ ($('stl-nova-aba')).checked = l ? l.nova_aba !== false : true;
  /** @type {HTMLInputElement} */ ($('stl-ativo')).checked = l ? !!l.ativo : true;
  const zap = String((ST.config && ST.config.whatsapp) || '').replace(/\D/g, '');
  $('stl-atalhos').innerHTML = [
    ...(zap ? [[`https://wa.me/${zap}`, 'WhatsApp do site']] : []),
    ['/', 'Site (siimob.com)'],
    ['/#interesse', 'Formulário do site'],
    ['/blog', '/blog'],
    ['/contato', '/contato']
  ]
    .map(([u, r]) => `<button type="button" data-acao="stAtalhoUrl" data-url="${esc(u)}">${esc(r)}</button>`)
    .join('');
  erroModal('stl-erro', '');
  previaImagem('stl-imagem', 'stl-prev');
  pintarCamposLink();
  abrir('modal-st-link');
  /** @type {HTMLInputElement} */ ($('stl-titulo')).focus();
}

function tipoEscolhido() {
  const r = /** @type {HTMLInputElement|null} */ (document.querySelector('input[name="stl-tipo"]:checked'));
  return r ? r.value : 'link';
}
function pintarCamposLink() {
  const t = tipoEscolhido();
  $('stl-bloco-url').hidden = t === 'secao';
  $('stl-bloco-imagem').hidden = t !== 'banner';
  $('stl-bloco-icone').hidden = t === 'banner' || t === 'secao';
  $('stl-bloco-sub').hidden = t === 'secao';
  $('stl-bloco-aba').hidden = t === 'secao';
}

async function salvarLink() {
  const tipo = tipoEscolhido();
  const titulo = val('stl-titulo');
  const url = val('stl-url');
  const imagem = val('stl-imagem');
  if (!titulo)
    return erroModal(
      'stl-erro',
      tipo === 'banner' ? 'Escreva um título (vira o texto alternativo da imagem).' : 'Escreva o título.'
    );
  if (tipo !== 'secao' && !/^(https?:\/\/|\/(?!\/)|mailto:|tel:)/i.test(url))
    return erroModal(
      'stl-erro',
      'O endereço precisa começar com https://, / (página do site), mailto: ou tel:.'
    );
  if (tipo === 'banner' && !/^(https?:\/\/|\/)/.test(imagem))
    return erroModal('stl-erro', 'Envie a imagem do banner.');
  const inicio = doCampo(val('stl-inicio'));
  const fim = doCampo(val('stl-fim'));
  if (inicio && fim && fim <= inicio) return erroModal('stl-erro', 'O fim precisa ser depois do início.');
  const corpo = {
    tipo,
    titulo,
    subtitulo: tipo === 'secao' ? null : val('stl-subtitulo') || null,
    url: tipo === 'secao' ? null : url,
    imagem_url: tipo === 'banner' ? imagem : null,
    icone: tipo === 'link' || tipo === 'destaque' ? val('stl-icone') || null : null,
    nova_aba: /** @type {HTMLInputElement} */ ($('stl-nova-aba')).checked,
    ativo: /** @type {HTMLInputElement} */ ($('stl-ativo')).checked,
    inicio_em: inicio,
    fim_em: fim
  };
  const btn = /** @type {HTMLButtonElement} */ ($('stl-salvar'));
  btn.disabled = true;
  try {
    if (ST.editLink)
      await pedir(`${rest('a1_site_links')}?id=eq.${ST.editLink}`, {
        method: 'PATCH',
        headers: H(),
        body: JSON.stringify(corpo)
      });
    else {
      const ordem = ST.links.reduce((m, x) => Math.max(m, Number(x.ordem) || 0), 0) + 10;
      await pedir(rest('a1_site_links'), {
        method: 'POST',
        headers: H(),
        body: JSON.stringify({ ...corpo, ordem })
      });
    }
    fechar('modal-st-link');
    SA.toast(ST.editLink ? 'Item salvo' : 'Item criado', 'success');
    await siteAdminAbrir();
  } catch (e) {
    erroModal('stl-erro', 'Não consegui salvar: ' + /** @type {Error} */ (e).message);
  } finally {
    btn.disabled = false;
  }
}

async function ligarLink(/** @type {string} */ id) {
  const l = ST.links.find(x => x.id === id);
  if (!l) return;
  try {
    await pedir(`${rest('a1_site_links')}?id=eq.${id}`, {
      method: 'PATCH',
      headers: H(),
      body: JSON.stringify({ ativo: !l.ativo })
    });
    SA.toast(l.ativo ? 'Item saiu da página' : 'Item na página', 'info');
    await siteAdminAbrir();
  } catch (e) {
    SA.toast('Não consegui alterar: ' + /** @type {Error} */ (e).message, 'error');
  }
}

// Trocar de lugar é regravar a ordem da lista inteira de 10 em 10: sobra espaço
// para o próximo item, e ordens repetidas antigas se acertam sozinhas.
async function moverLink(/** @type {string} */ id, /** @type {number} */ d) {
  const i = ST.links.findIndex(x => x.id === id);
  const j = i + d;
  if (i < 0 || j < 0 || j >= ST.links.length) return;
  const lista = ST.links.slice();
  [lista[i], lista[j]] = [lista[j], lista[i]];
  const mudam = lista
    .map((x, k) => ({ id: x.id, ordem: (k + 1) * 10 }))
    .filter((x, k) => lista[k].ordem !== x.ordem);
  try {
    await Promise.all(
      mudam.map(x =>
        pedir(`${rest('a1_site_links')}?id=eq.${x.id}`, {
          method: 'PATCH',
          headers: H(),
          body: JSON.stringify({ ordem: x.ordem })
        })
      )
    );
    await siteAdminAbrir();
  } catch (e) {
    SA.toast('Não consegui mudar a ordem: ' + /** @type {Error} */ (e).message, 'error');
  }
}

async function excluirLink(/** @type {string} */ id) {
  const l = ST.links.find(x => x.id === id);
  if (!l || !confirm(`Excluir "${l.titulo}" da página de links?`)) return;
  try {
    await pedir(`${rest('a1_site_links')}?id=eq.${id}`, { method: 'DELETE', headers: H() });
    SA.toast('Item excluído', 'info');
    await siteAdminAbrir();
  } catch (e) {
    SA.toast('Não consegui excluir: ' + /** @type {Error} */ (e).message, 'error');
  }
}

// ─── Canais de contato ───────────────────────────────────────────────────────
function vistaCanais() {
  const c = ST.config;
  const campo = (
    /** @type {string} */ k,
    /** @type {string} */ rot,
    /** @type {string} */ ph,
    /** @type {string=} */ extra
  ) =>
    `<div class="form-group"><label for="st-${k}">${rot}</label><input id="st-${k}" value="${esc(c[k] || '')}" placeholder="${esc(ph)}"${extra || ''}></div>`;
  return `
    <div class="panel st-card">
      <div class="section-hdr"><div class="section-title">Canais de contato</div>
        <a class="btn btn-ghost btn-sm" href="/contato" target="_blank" rel="noopener">Ver /contato ↗</a></div>
      <p class="st-dica st-dica-topo">Aparecem na página de contato, no pé da página de links e no rodapé do site. Campo vazio não aparece.</p>
      <div class="form-grid cols-2">
        ${campo('whatsapp', 'WhatsApp (com DDI e DDD)', '5598999999999', ' inputmode="numeric"')}
        ${campo('whatsapp_msg', 'Mensagem que já vem escrita', 'Olá! Vim pelo site do SIIMOB.')}
        ${campo('email', 'E-mail', 'contato@siimob.com.br', ' type="email"')}
        ${campo('telefone', 'Telefone', '(98) 3000-0000')}
        ${campo('horario', 'Horário de atendimento', 'Segunda a sexta, das 9h às 18h')}
        ${campo('endereco', 'Endereço', 'São Luís, MA')}
      </div>
      <div class="section-title st-mt2">Redes sociais</div>
      <div class="form-grid cols-2 st-mt">
        ${REDES.map(([k, rot, ph]) => campo(k, rot, ph, ' type="url"')).join('')}
      </div>
      <div class="st-pe"><button class="btn btn-primary" data-acao="stSalvarCanais">Salvar canais</button></div>
    </div>`;
}

async function salvarCanais() {
  const zap = val('st-whatsapp').replace(/\D/g, '');
  if (zap && (zap.length < 12 || zap.length > 13))
    return SA.toast('WhatsApp: use DDI + DDD + número, só dígitos (ex.: 5598999999999).', 'error');
  const email = val('st-email');
  if (email && !/^[^@\s]+@[^@\s]+\.[^@\s]{2,}$/.test(email)) return SA.toast('Confira o e-mail.', 'error');
  for (const [k, rot] of REDES) {
    const u = val('st-' + k);
    if (u && !/^https:\/\//i.test(u))
      return SA.toast(`${rot}: cole o endereço completo, começando com https://`, 'error');
  }
  /** @type {HTMLInputElement} */ ($('st-whatsapp')).value = zap;
  await salvarConfig(
    ['whatsapp', 'whatsapp_msg', 'email', 'telefone', 'horario', 'endereco', ...REDES.map(r => r[0])],
    'Canais de contato salvos'
  );
}

async function salvarConfig(/** @type {string[]} */ campos, /** @type {string} */ ok) {
  /** @type {Record<string, string|null>} */
  const corpo = {};
  campos.forEach(k => {
    corpo[k] = val('st-' + k) || null;
  });
  if ('links_titulo' in corpo && !corpo.links_titulo) corpo.links_titulo = 'SIIMOB';
  if ('links_frase' in corpo && !corpo.links_frase) corpo.links_frase = '';
  try {
    await pedir(`${rest('a1_site_config')}?id=eq.1`, {
      method: 'PATCH',
      headers: H(),
      body: JSON.stringify(corpo)
    });
    Object.assign(ST.config, corpo);
    SA.toast(ok, 'success');
  } catch (e) {
    SA.toast('Não consegui salvar: ' + /** @type {Error} */ (e).message, 'error');
  }
}

// ─── Blog ────────────────────────────────────────────────────────────────────
function situacaoPost(/** @type {any} */ p) {
  if (!p.publicado) return ['Rascunho', 'st-st-off'];
  if (p.publicado_em && new Date(p.publicado_em).getTime() > Date.now()) return ['Agendado', 'st-st-agenda'];
  return ['No ar', 'st-st-on'];
}
function vistaBlog() {
  const linhas = ST.posts
    .map(p => {
      const [sit, cls] = situacaoPost(p);
      return `<tr>
        <td><div class="st-item">
          ${p.capa_url ? `<img class="st-thumb" src="${esc(p.capa_url)}" alt="">` : '<span class="st-thumb st-thumb-vazia"></span>'}
          <div><b>${esc(p.titulo)}${p.destaque ? ' <span class="st-estrela" title="Destaque">★</span>' : ''}</b>
            <small>/blog/${esc(p.slug)}</small></div>
        </div></td>
        <td>${esc(p.categoria || '')}</td>
        <td><span class="st-st ${cls}">${sit}</span>${p.publicado_em ? `<small class="st-quando">${esc(quando(p.publicado_em))}</small>` : ''}</td>
        <td class="st-acoes">
          ${sit === 'No ar' ? `<a class="btn btn-ghost btn-sm" href="/blog/${esc(p.slug)}" target="_blank" rel="noopener">Ver ↗</a>` : ''}
          <button class="btn btn-ghost btn-sm" data-acao="stEditarPost" data-id="${esc(p.id)}">Editar</button>
          <button class="btn btn-ghost btn-sm" data-acao="stPublicarPost" data-id="${esc(p.id)}">${p.publicado ? 'Despublicar' : 'Publicar'}</button>
          <button class="btn btn-ghost btn-sm st-perigo" data-acao="stExcluirPost" data-id="${esc(p.id)}">Excluir</button>
        </td></tr>`;
    })
    .join('');
  return `<div class="panel st-card">
    <div class="section-hdr"><div class="section-title">Artigos (${ST.posts.length})</div>
      <div class="st-hdr-acoes"><a class="btn btn-ghost btn-sm" href="/blog" target="_blank" rel="noopener">Ver /blog ↗</a>
      <button class="btn btn-primary" data-acao="stNovoPost">+ Novo artigo</button></div></div>
    ${
      ST.posts.length
        ? `<div class="st-tabela"><table><thead><tr><th>Artigo</th><th>Categoria</th><th>Situação</th><th></th></tr></thead><tbody>${linhas}</tbody></table></div>`
        : '<div class="st-vazio">Nenhum artigo ainda. O blog mostra "Os primeiros artigos estão chegando" até o primeiro ir ao ar.</div>'
    }
  </div>`;
}

async function abrirPost(/** @type {string|null} */ id) {
  /** @type {any} */
  let p = null;
  if (id) {
    try {
      const l = await pedir(`${rest('a1_blog_posts')}?id=eq.${id}&select=*`, { headers: H() });
      p = l && l[0];
    } catch (e) {
      SA.toast('Não consegui abrir o artigo: ' + /** @type {Error} */ (e).message, 'error');
      return;
    }
  }
  ST.editPost = p ? p.id : null;
  ST.slugManual = !!p;
  $('stp-titulo-modal').textContent = p ? 'Editar artigo' : 'Novo artigo';
  const set = (/** @type {string} */ i, /** @type {any} */ v) => {
    /** @type {HTMLInputElement} */ ($(i)).value = v == null ? '' : String(v);
  };
  set('stp-titulo', p && p.titulo);
  set('stp-slug', p && p.slug);
  set('stp-categoria', (p && p.categoria) || 'Dicas');
  set('stp-autor', (p && p.autor) || '');
  set('stp-resumo', p && p.resumo);
  set('stp-capa', p && p.capa_url);
  set('stp-conteudo', (p && p.conteudo) || '');
  set('stp-data', paraCampo((p && p.publicado_em) || null));
  /** @type {HTMLInputElement} */ ($('stp-destaque')).checked = !!(p && p.destaque);
  const cats = [...new Set([...CATEGORIAS, ...ST.posts.map(x => x.categoria).filter(Boolean)])];
  $('stp-cats').innerHTML = cats.map(c => `<option value="${esc(c)}">`).join('');
  $('stp-publicar').textContent = p && p.publicado ? 'Salvar e manter no ar' : 'Publicar';
  erroModal('stp-erro', '');
  previaImagem('stp-capa', 'stp-capa-prev');
  pintarEndereco();
  contarResumo();
  trocarAba('escrever');
  abrir('modal-st-post');
  /** @type {HTMLInputElement} */ ($('stp-titulo')).focus();
}

function pintarEndereco() {
  $('stp-endereco').textContent = `siimob.com.br/blog/${val('stp-slug') || '…'}`;
}
function contarResumo() {
  const n = val('stp-resumo').length;
  const el = $('stp-resumo-n');
  el.textContent = `${n}/220`;
  el.classList.toggle('st-passou', n > 220);
}
function trocarAba(/** @type {string} */ a) {
  ST.aba = a;
  document
    .querySelectorAll('.st-abas button')
    .forEach(b => b.classList.toggle('on', /** @type {HTMLElement} */ (b).dataset.a === a));
  const previa = a === 'previa';
  $('stp-escrever').hidden = previa;
  $('stp-previa').hidden = !previa;
  if (previa) {
    const t = /** @type {HTMLTextAreaElement} */ ($('stp-conteudo')).value;
    $('stp-previa').innerHTML = t.trim() ? markdown(t) : '<p class="st-dica">Nada escrito ainda.</p>';
  }
}

/** A barra de ferramentas do texto: envolve a seleção ou insere no cursor. */
function ferramenta(/** @type {string} */ f) {
  const ta = /** @type {HTMLTextAreaElement} */ ($('stp-conteudo'));
  const ini = ta.selectionStart;
  const fim = ta.selectionEnd;
  const sel = ta.value.slice(ini, fim);
  const linha = (/** @type {string} */ prefixo, /** @type {string} */ padrao) =>
    `${ini > 0 && ta.value[ini - 1] !== '\n' ? '\n\n' : ''}${prefixo}${sel || padrao}`;
  /** @type {Record<string, string>} */
  const mapa = {
    h2: linha('## ', 'Título da seção'),
    h3: linha('### ', 'Subtítulo'),
    negrito: `**${sel || 'texto em negrito'}**`,
    italico: `*${sel || 'texto em itálico'}*`,
    link: `[${sel || 'texto do link'}](https://)`,
    lista: linha('- ', 'Item da lista'),
    numerada: linha('1. ', 'Primeiro passo'),
    citacao: linha('> ', 'Uma frase em destaque'),
    linha: '\n\n---\n\n'
  };
  if (!(f in mapa)) return;
  ta.setRangeText(mapa[f], ini, fim, 'end');
  ta.focus();
}
function inserir(/** @type {string} */ txt) {
  const ta = /** @type {HTMLTextAreaElement} */ ($('stp-conteudo'));
  ta.setRangeText(txt, ta.selectionStart, ta.selectionEnd, 'end');
  ta.focus();
}

async function salvarPost(/** @type {boolean} */ publicar) {
  const titulo = val('stp-titulo');
  const slug = slugDe(val('stp-slug') || titulo);
  const conteudo = /** @type {HTMLTextAreaElement} */ ($('stp-conteudo')).value;
  const resumo = val('stp-resumo');
  if (!titulo) return erroModal('stp-erro', 'Escreva o título.');
  if (!slug) return erroModal('stp-erro', 'O endereço do artigo ficou vazio.');
  if (resumo.length > 220) return erroModal('stp-erro', 'O resumo passou de 220 caracteres.');
  if (publicar && !conteudo.trim()) return erroModal('stp-erro', 'Escreva o texto antes de publicar.');
  const capa = val('stp-capa');
  if (capa && !/^(https?:\/\/|\/)/.test(capa))
    return erroModal('stp-erro', 'A capa precisa ser um endereço de imagem.');
  const atual = ST.editPost ? ST.posts.find(x => x.id === ST.editPost) : null;
  // A data escolhida vale; sem ela, publicar agora. Rascunho guarda a data
  // escolhida, para a estreia não mudar quando ele for publicado depois.
  const data =
    doCampo(val('stp-data')) || (publicar ? (atual && atual.publicado_em) || new Date().toISOString() : null);
  const corpo = {
    titulo,
    slug,
    categoria: val('stp-categoria') || 'Dicas',
    autor: val('stp-autor') || null,
    resumo: resumo || null,
    capa_url: capa || null,
    conteudo,
    tempo_leitura: minutosDeLeitura(conteudo),
    destaque: /** @type {HTMLInputElement} */ ($('stp-destaque')).checked,
    publicado: publicar,
    publicado_em: data
  };
  const btns = ['stp-publicar', 'stp-rascunho'].map(i => /** @type {HTMLButtonElement} */ ($(i)));
  btns.forEach(b => (b.disabled = true));
  try {
    if (ST.editPost)
      await pedir(`${rest('a1_blog_posts')}?id=eq.${ST.editPost}`, {
        method: 'PATCH',
        headers: H(),
        body: JSON.stringify(corpo)
      });
    else await pedir(rest('a1_blog_posts'), { method: 'POST', headers: H(), body: JSON.stringify(corpo) });
    fechar('modal-st-post');
    const futuro = publicar && data && new Date(data).getTime() > Date.now();
    SA.toast(
      publicar ? (futuro ? `Agendado para ${quando(data)}` : 'Artigo no ar') : 'Rascunho salvo',
      'success'
    );
    await siteAdminAbrir();
  } catch (e) {
    erroModal('stp-erro', 'Não consegui salvar: ' + /** @type {Error} */ (e).message);
  } finally {
    btns.forEach(b => (b.disabled = false));
  }
}

async function alternarPost(/** @type {string} */ id) {
  const p = ST.posts.find(x => x.id === id);
  if (!p) return;
  /** @type {Record<string, any>} */
  const corpo = { publicado: !p.publicado };
  if (!p.publicado && !p.publicado_em) corpo.publicado_em = new Date().toISOString();
  try {
    await pedir(`${rest('a1_blog_posts')}?id=eq.${id}`, {
      method: 'PATCH',
      headers: H(),
      body: JSON.stringify(corpo)
    });
    SA.toast(p.publicado ? 'Artigo saiu do ar' : 'Artigo publicado', 'info');
    await siteAdminAbrir();
  } catch (e) {
    SA.toast('Não consegui alterar: ' + /** @type {Error} */ (e).message, 'error');
  }
}

async function excluirPost(/** @type {string} */ id) {
  const p = ST.posts.find(x => x.id === id);
  if (!p || !confirm(`Excluir o artigo "${p.titulo}"? Isso não pode ser desfeito.`)) return;
  try {
    await pedir(`${rest('a1_blog_posts')}?id=eq.${id}`, { method: 'DELETE', headers: H() });
    SA.toast('Artigo excluído', 'info');
    await siteAdminAbrir();
  } catch (e) {
    SA.toast('Não consegui excluir: ' + /** @type {Error} */ (e).message, 'error');
  }
}

// ─── Modais ──────────────────────────────────────────────────────────────────
function modais() {
  const icones = Object.entries(ICONES)
    .map(([k, v]) => `<option value="${k}">${esc(v.rotulo)}</option>`)
    .join('');
  const tipos = Object.entries(TIPOS)
    .map(
      ([k, [rot, ajuda]]) =>
        `<label class="st-tipo"><input type="radio" name="stl-tipo" value="${k}" data-acao-change="stTipoLink"><span><b>${rot}</b><small>${ajuda}</small></span></label>`
    )
    .join('');
  const ferr = [
    ['h2', 'Título', 'H2'],
    ['h3', 'Subtítulo', 'H3'],
    ['negrito', 'Negrito', '<b>B</b>'],
    ['italico', 'Itálico', '<i>I</i>'],
    ['link', 'Link', 'Link'],
    ['lista', 'Lista', '• Lista'],
    ['numerada', 'Lista numerada', '1. Lista'],
    ['citacao', 'Citação', '“ ”'],
    ['linha', 'Linha divisória', '—']
  ]
    .map(
      ([f, t, r]) => `<button type="button" data-acao="stFerramenta" data-f="${f}" title="${t}">${r}</button>`
    )
    .join('');
  return `
  <div class="modal-bg hidden" id="modal-st-link">
    <div class="modal" style="max-width:640px">
      <div class="modal-hdr"><div class="modal-title" id="stl-titulo-modal">Novo item</div>
        <button class="modal-close" data-acao="stFechar" data-id="modal-st-link" aria-label="Fechar">&#x2715;</button></div>
      <div class="modal-body">
        <div class="st-erro" id="stl-erro" hidden></div>
        <div class="st-tipos">${tipos}</div>
        <div class="form-group st-mt"><label for="stl-titulo">Título *</label><input id="stl-titulo" maxlength="80" placeholder="Ex.: Fale com um consultor"></div>
        <div class="form-group st-mt" id="stl-bloco-sub"><label for="stl-subtitulo">Linha de apoio</label><input id="stl-subtitulo" maxlength="120" placeholder="Opcional, aparece embaixo do título"></div>
        <div class="form-group st-mt" id="stl-bloco-url"><label for="stl-url">Endereço *</label><input id="stl-url" placeholder="https://… ou /contato">
          <div class="st-atalhos" id="stl-atalhos"></div></div>
        <div class="form-group st-mt" id="stl-bloco-icone"><label for="stl-icone">Ícone</label><select id="stl-icone"><option value="">Sem ícone</option>${icones}</select></div>
        <div class="st-mt" id="stl-bloco-imagem">
          <div class="form-group"><label for="stl-imagem">Imagem do banner *</label>
            <div class="st-linha"><input id="stl-imagem" placeholder="Envie um arquivo ou cole o endereço" data-acao-change="stPreviaImagemLink">
              <label class="btn btn-ghost st-arq">Enviar imagem<input type="file" accept="image/png,image/jpeg,image/webp,image/gif" data-acao-change="stSubirImagemLink"></label></div>
            <small class="st-dica">1200 × 560 px, até 5 MB.</small></div>
          <div class="st-prev" id="stl-prev"></div>
        </div>
        <div class="form-grid cols-2 st-mt">
          <div class="form-group"><label for="stl-inicio">Aparece a partir de</label><input id="stl-inicio" type="datetime-local"></div>
          <div class="form-group"><label for="stl-fim">Some depois de</label><input id="stl-fim" type="datetime-local"></div>
        </div>
        <div class="st-checks st-mt">
          <label id="stl-bloco-aba"><input type="checkbox" id="stl-nova-aba"> Abrir site de fora em nova aba</label>
          <label><input type="checkbox" id="stl-ativo"> Na página</label>
        </div>
      </div>
      <div class="st-rodape-modal">
        <button class="btn btn-ghost" data-acao="stFechar" data-id="modal-st-link">Cancelar</button>
        <button class="btn btn-primary" id="stl-salvar" data-acao="stSalvarLink">Salvar</button>
      </div>
    </div>
  </div>

  <div class="modal-bg hidden" id="modal-st-post">
    <div class="modal st-modal-post">
      <div class="modal-hdr"><div class="modal-title" id="stp-titulo-modal">Novo artigo</div>
        <button class="modal-close" data-acao="stFechar" data-id="modal-st-post" aria-label="Fechar">&#x2715;</button></div>
      <div class="modal-body st-post-corpo">
        <div class="st-erro" id="stp-erro" hidden></div>
        <div class="st-post-grade">
          <div class="st-post-texto">
            <div class="form-group"><label for="stp-titulo">Título *</label><input id="stp-titulo" class="st-titulo-grande" maxlength="140" placeholder="Ex.: Funil de vendas imobiliário: como montar e gerenciar" data-acao-input="stTituloPost"></div>
            <div class="form-group st-mt"><label for="stp-resumo">Resumo <span id="stp-resumo-n" class="st-contador">0/220</span></label>
              <textarea id="stp-resumo" rows="2" placeholder="Aparece na lista do blog e no Google" data-acao-input="stResumoPost"></textarea></div>
            <div class="st-abas st-mt">
              <button type="button" class="on" data-acao="stAbaPost" data-a="escrever">Escrever</button>
              <button type="button" data-acao="stAbaPost" data-a="previa">Pré-visualizar</button>
            </div>
            <div id="stp-escrever">
              <div class="st-ferr">${ferr}
                <label class="st-ferr-img" title="Inserir imagem no texto">Imagem<input type="file" accept="image/png,image/jpeg,image/webp,image/gif" data-acao-change="stSubirImagemTexto"></label></div>
              <textarea id="stp-conteudo" class="st-conteudo" placeholder="Escreva o artigo. ## para títulos, - para listas, **negrito**, [link](https://…)."></textarea>
            </div>
            <div id="stp-previa" class="st-previa" hidden></div>
          </div>
          <aside class="st-post-lado">
            <div class="form-group"><label for="stp-slug">Endereço</label><input id="stp-slug" data-acao-change="stSlugPost"><small class="st-dica" id="stp-endereco"></small></div>
            <div class="form-group st-mt"><label for="stp-categoria">Categoria</label><input id="stp-categoria" list="stp-cats"><datalist id="stp-cats"></datalist></div>
            <div class="form-group st-mt"><label for="stp-autor">Autor</label><input id="stp-autor" placeholder="Equipe SIIMOB"></div>
            <div class="form-group st-mt"><label for="stp-data">Data de publicação</label><input id="stp-data" type="datetime-local"><small class="st-dica">Vazio = agora. Data futura agenda o artigo.</small></div>
            <div class="form-group st-mt"><label for="stp-capa">Capa</label>
              <input id="stp-capa" placeholder="Envie ou cole o endereço" data-acao-change="stPreviaCapa">
              <label class="btn btn-ghost st-arq st-mt-p">Enviar capa<input type="file" accept="image/png,image/jpeg,image/webp,image/gif" data-acao-change="stSubirCapa"></label>
              <small class="st-dica">1600 × 900 px. Sem capa, o blog desenha uma com o título.</small></div>
            <div class="st-prev" id="stp-capa-prev"></div>
            <label class="st-check-linha st-mt"><input type="checkbox" id="stp-destaque"> Destaque no topo do blog</label>
          </aside>
        </div>
      </div>
      <div class="st-rodape-modal">
        <button class="btn btn-ghost" data-acao="stFechar" data-id="modal-st-post">Cancelar</button>
        <button class="btn btn-ghost" id="stp-rascunho" data-acao="stSalvarPost" data-publicar="false">Salvar rascunho</button>
        <button class="btn btn-primary" id="stp-publicar" data-acao="stSalvarPost" data-publicar="true">Publicar</button>
      </div>
    </div>
  </div>`;
}
