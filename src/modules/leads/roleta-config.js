// ─── Configurações › Leads › Roleta de distribuição ──────────────────────────
//
// Os corretores que recebem os leads qualificados na Central de atendimento,
// e a ordem do rodízio ("Rodízio: um de cada vez, em ordem, entre os
// corretores participantes" — decisão do dono). Só existe com a licença
// ATENDIMENTO e só para o gestor; quem grava é a1_roleta_salvar, que confere
// que cada participante é corretor do próprio cliente.
import { A1 } from '../../shared/api/config.js';
import { esc } from '../../shared/utils/texto.js';
import { acoes } from '../../shared/ui/acoes.js';

const R = {
  /** @type {(m:string, t?:string)=>void} */ toast: () => {},
  corretores: /** @type {{id:string,name:string,is_active?:boolean,approved?:boolean}[]} */ ([]),
  participantes: /** @type {string[]} */ ([]),
  proximo: /** @type {string|null} */ (null),
  sujo: false
};
const $ = (/** @type {string} */ id) => document.getElementById(id);

const ICONE = `<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="#0B7568" stroke-width="2"
  stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="9"/><path d="M12 3v4M12 17v4M3 12h4M17 12h4"/><circle cx="12" cy="12" r="2.5"/></svg>`;

acoes({
  roletaMarcar: el => {
    const id = el.dataset.id || '';
    const marcado = /** @type {HTMLInputElement} */ (el).checked;
    R.participantes = marcado ? [...R.participantes, id] : R.participantes.filter(x => x !== id);
    R.sujo = true;
    desenhar();
  },
  roletaSubir: el => mover(el.dataset.id || '', -1),
  roletaDescer: el => mover(el.dataset.id || '', 1),
  roletaSalvar: () => salvar()
});

function mover(/** @type {string} */ id, /** @type {number} */ passo) {
  const i = R.participantes.indexOf(id);
  const j = i + passo;
  if (i < 0 || j < 0 || j >= R.participantes.length) return;
  const l = [...R.participantes];
  [l[i], l[j]] = [l[j], l[i]];
  R.participantes = l;
  R.sujo = true;
  desenhar();
}

/** Cria o cartão e a sub-tela. f = { cartao, vista, toast } (peças do hub). */
export function roletaMontarConfig(f) {
  R.toast = f.toast || R.toast;
  f.cartao({
    id: 'cfg-card-roleta',
    modulo: 'ATENDIMENTO',
    grade: 'cfg-cards-leads',
    view: 'roleta',
    rotulo: 'Roleta de distribuição',
    fundo: '#E6F4F1',
    icone: ICONE
  });
  f.vista(
    'roleta',
    'Leads — Roleta de distribuição',
    `<div class="cfg-explica" style="max-width:900px">
      Quando o lead é qualificado na Central de atendimento, ele vai para o próximo corretor da roleta, em rodízio:
      um de cada vez, na ordem abaixo. O lead entra no funil com o corretor como responsável, na etapa
      <b>Em atendimento</b>. Corretor desligado ou não aprovado é pulado automaticamente.
    </div>
    <div id="roleta-corpo"><div class="cfg-explica">Carregando…</div></div>`
  );
  const sec = $('cfg-sec-leads');
  if (sec) sec.style.display = '';
}

/** Chamado ao abrir a sub-tela. */
export async function roletaAbrir() {
  const [corretores, roleta, proximo] = await Promise.all([
    A1.buscarTudo(
      `${A1.rest('a1_partners')}?type=eq.corretor&select=id,name,is_active,approved&order=name.asc`
    )
      .then(r => (r && r.linhas) || [])
      .catch(() => []),
    fetch(`${A1.rest('a1_lead_roleta')}?select=participantes`, { headers: A1.headers() })
      .then(r => (r.ok ? r.json() : []))
      .catch(() => []),
    fetch(A1.rpc('a1_roleta_proximo_nome'), { method: 'POST', headers: A1.headers(), body: '{}' })
      .then(r => (r.ok ? r.json() : null))
      .catch(() => null)
  ]);
  R.corretores = Array.isArray(corretores) ? corretores : [];
  R.participantes = ((roleta && roleta[0] && roleta[0].participantes) || []).filter(id =>
    R.corretores.some(c => c.id === id)
  );
  R.proximo = typeof proximo === 'string' ? proximo : null;
  R.sujo = false;
  desenhar();
}

const ativo = (/** @type {any} */ c) => c.is_active !== false && c.approved !== false;

function desenhar() {
  const corpo = $('roleta-corpo');
  if (!corpo) return;
  if (!R.corretores.length) {
    corpo.innerHTML =
      '<div class="cfg-explica">Nenhum corretor cadastrado. Cadastre em Configurações › Corretores.</div>';
    return;
  }
  const porId = new Map(R.corretores.map(c => [c.id, c]));
  const ordem = R.participantes.map(id => porId.get(id)).filter(Boolean);
  const fora = R.corretores.filter(c => !R.participantes.includes(c.id));
  const linhaOrdem = (/** @type {any} */ c, /** @type {number} */ i) => `
    <li class="roleta-item${ativo(c) ? '' : ' roleta-off'}">
      <span class="roleta-pos">${i + 1}</span>
      <label><input type="checkbox" checked data-acao-change="roletaMarcar" data-id="${esc(c.id)}"> ${esc(c.name)}</label>
      ${ativo(c) ? '' : '<small>desligado: é pulado</small>'}
      ${!R.sujo && R.proximo && R.proximo === c.name ? '<small class="roleta-vez">próximo da vez</small>' : ''}
      <span class="roleta-mover">
        <button type="button" class="btn btn-ghost btn-sm" data-acao="roletaSubir" data-id="${esc(c.id)}" ${i === 0 ? 'disabled' : ''} aria-label="Subir ${esc(c.name)}">↑</button>
        <button type="button" class="btn btn-ghost btn-sm" data-acao="roletaDescer" data-id="${esc(c.id)}" ${i === ordem.length - 1 ? 'disabled' : ''} aria-label="Descer ${esc(c.name)}">↓</button>
      </span>
    </li>`;
  corpo.innerHTML = `
    <div class="card roleta-card">
      <h4>Na roleta, em ordem (${ordem.length})</h4>
      ${ordem.length ? `<ol class="roleta-lista">${ordem.map(linhaOrdem).join('')}</ol>` : '<p class="roleta-vazia">Ninguém na roleta: a Central não consegue distribuir. Marque os corretores abaixo.</p>'}
      <h4 style="margin-top:1.1rem">Fora da roleta (${fora.length})</h4>
      ${
        fora.length
          ? `<ul class="roleta-lista">${fora
              .map(
                c =>
                  `<li class="roleta-item${ativo(c) ? '' : ' roleta-off'}"><label><input type="checkbox" data-acao-change="roletaMarcar" data-id="${esc(c.id)}"> ${esc(c.name)}</label>${ativo(c) ? '' : '<small>desligado</small>'}</li>`
              )
              .join('')}</ul>`
          : '<p class="roleta-vazia">Todos os corretores estão na roleta.</p>'
      }
      <div class="roleta-rodape">
        <button type="button" class="btn btn-primary" data-acao="roletaSalvar" ${R.sujo ? '' : 'disabled'}>Salvar roleta</button>
        <span id="roleta-msg" role="status"></span>
      </div>
    </div>`;
}

async function salvar() {
  const msg = $('roleta-msg');
  if (msg) msg.textContent = 'Salvando…';
  try {
    const r = await fetch(A1.rpc('a1_roleta_salvar'), {
      method: 'POST',
      headers: A1.headers(),
      body: JSON.stringify({ p_participantes: R.participantes })
    });
    if (!r.ok) {
      const t = await r.text().catch(() => '');
      throw new Error(
        /participante_nao_e_corretor/.test(t)
          ? 'Só corretores podem entrar na roleta.'
          : /sem_permissao/.test(t)
            ? 'Só o gestor configura a roleta.'
            : /modulo_desabilitado/.test(t)
              ? 'A Central de atendimento não está liberada para esta empresa.'
              : 'Não foi possível salvar agora.'
      );
    }
    R.toast('Roleta salva.', 'success');
    await roletaAbrir();
  } catch (e) {
    if (msg) msg.textContent = /** @type {Error} */ (e).message;
  }
}
