// @ts-check
// ─── Regras da pré-análise ───────────────────────────────────────────────────
//
// O que o cadastro da pré-análise exige: corretor, imobiliária, analista,
// empresa e usuário correspondente, unidade, valor de avaliação e o cônjuge de
// quem é casado. Mora em Configurações porque é configuração ("tudo que for de
// configuração vai estar em um único lugar"), num cartão que só nasce com a
// licença da Pré-análise.
//
// Quem exige de verdade é o banco (gatilho zzz_a1_pa_regras, em
// 2026-11-03_reserva_pre_analise_e_selos.sql). A exceção é o cônjuge: ele é
// gravado depois da pré-análise, como participante, e por isso é conferido no
// assistente.
import { A1 } from '../../shared/api/config.js';
import { esc } from '../../shared/utils/texto.js';
import { acoes } from '../../shared/ui/acoes.js';

acoes({
  regrasPaSalvar: () => salvar()
});

/** @type {{toast:(m:string,t?:string)=>void}} */
const RP = { toast: () => {} };

const REGRAS = [
  [
    'exige_corretor',
    'Corretor vinculado',
    'A pré-análise só nasce com corretor. O corretor que cria já entra como dono dela.'
  ],
  [
    'exige_imobiliaria',
    'Imobiliária vinculada',
    'A pré-análise só nasce com a imobiliária do corretor ou a escolhida pelo gestor.'
  ],
  [
    'exige_analista',
    'Analista vinculado',
    'Com o Ciclo de Distribuição ligado, quem preenche é o ciclo, e a regra confere o resultado.'
  ],
  [
    'exige_empresa',
    'Empresa correspondente vinculada',
    'Idem: com o ciclo ligado, é ele quem escolhe a empresa.'
  ],
  [
    'exige_correspondente',
    'Usuário correspondente vinculado',
    'Idem: com o ciclo ligado, é ele quem escolhe o usuário.'
  ],
  ['exige_unidade', 'Unidade de interesse', 'Bloco e unidade (com a Disposição) ou o texto da unidade.'],
  [
    'exige_valor_avaliacao',
    'Valor de avaliação',
    'Com a Disposição, ele já vem do mapa de preço da unidade escolhida.'
  ],
  [
    'exige_conjuge',
    'Cônjuge de quem é casado(a) ou vive em união estável',
    'Os dados do cônjuge abrem logo abaixo do titular e passam a ser obrigatórios.'
  ]
];

/**
 * Cria o cartão e a sub-tela. Chamado por Configurações quando a licença da
 * Pré-análise responde exatamente true, só para gestor.
 * @param {{cartao:(d:any)=>void, vista:(n:string,t:string,h:string)=>void,
 *          toast:(m:string,t?:string)=>void}} f
 */
export function regrasPaMontar(f) {
  RP.toast = f.toast;
  f.cartao({
    id: 'cfg-card-regras-pa',
    modulo: 'PRE_ANALISE',
    grade: 'cfg-cards-workflow',
    view: 'regras-pa',
    rotulo: 'Regras da pré-análise',
    fundo: '#dff5f1',
    icone:
      '<svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="#0E8C7F" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M9 11l3 3L22 4"/><path d="M21 12v7a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11"/></svg>'
  });
  f.vista(
    'regras-pa',
    'Regras da pré-análise',
    `<div class="cfg-explica">O que o cadastro da pré-análise exige. Vale para todo mundo que cria, inclusive o gestor,
      e o banco confere de novo: uma pré-análise sem o que a regra pede não nasce. As que já existem não são afetadas;
      só não deixam apagar um campo exigido.</div>
     <div id="regras-pa-corpo" class="dc"></div>`
  );
}

/** Abre a sub-tela (roteador de Configurações). */
export async function regrasPaAbrir() {
  const alvo = document.getElementById('regras-pa-corpo');
  if (!alvo) return;
  alvo.innerHTML = '<div class="dc-vazio">Carregando…</div>';
  /** @type {any} */
  let v = {};
  try {
    const r = await fetch(A1.rpc('a1_pa_regras_vigentes'), {
      method: 'POST',
      headers: A1.headers(),
      body: '{}'
    });
    v = r.ok ? await r.json() : {};
  } catch {
    v = {};
  }
  alvo.innerHTML = `<div class="dc-cartao">
    ${v && v.salvas === false ? '<p class="dc-p">Ainda não há regra gravada para este cliente: o que está marcado é o padrão do perfil.</p>' : ''}
    <div class="dc-opcoes">${REGRAS.map(
      ([
        k,
        rot,
        ajuda
      ]) => `<label class="dc-opcao"><input type="checkbox" id="rp-${k}"${v && v[k] ? ' checked' : ''}>
        <span><b>${esc(rot)}</b><small>${esc(ajuda)}</small></span></label>`
    ).join('')}</div>
    <div class="dc-pe-d dc-salvar"><button class="btn btn-primary btn-sm" data-acao="regrasPaSalvar">Salvar regras</button></div>
  </div>`;
}

async function salvar() {
  /** @type {Record<string, any>} */
  const corpo = { tenant_id: A1.user && A1.user.tenant_id, atualizado_em: new Date().toISOString() };
  REGRAS.forEach(([k]) => {
    const el = /** @type {HTMLInputElement|null} */ (document.getElementById('rp-' + k));
    corpo[k] = !!(el && el.checked);
  });
  const r = await fetch(`${A1.rest('a1_pa_regras')}?on_conflict=tenant_id`, {
    method: 'POST',
    headers: A1.upsertHeaders(),
    body: JSON.stringify(corpo)
  });
  if (!r.ok) {
    RP.toast('Não consegui salvar as regras. Só o gestor altera as regras da pré-análise.', 'error');
    return;
  }
  RP.toast('Regras da pré-análise salvas.', 'success');
  regrasPaAbrir();
}
