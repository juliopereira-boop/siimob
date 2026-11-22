// ─── Central de atendimento (módulo ATENDIMENTO) ─────────────────────────────
//
// O PEDIDO DO DONO
//   "os leads que vêm das integrações caem no início do pipeline e entram na
//    central de atendimento (...) o agente entra em contato e qualifica, depois
//    envia o lead para a fila de distribuição e distribui para algum corretor
//    (...) omnichannel, igual o chatwoot, com características visuais do
//    WhatsApp + SIIMOB"
//
// COMO FUNCIONA
//   - A conversa nasce no banco quando um lead chega por integração (gatilho em
//     a1_cases, só com a licença). A tela só LÊ as tabelas; mandar mensagem,
//     distribuir e desqualificar são funções do banco (a1_atend_*), que
//     conferem quem pode o quê.
//   - Na fila (sem corretor) só o gestor vê e conversa: "se não for atribuído a
//     nenhum corretor, somente o gestor conversa". Depois da roleta, o corretor
//     da vez passa a ver e conversar com o lead dele.
//   - O WhatsApp ainda não está integrado: "Mensagem" abre o WhatsApp Web com o
//     texto e registra aqui o que foi mandado. Quando a integração vier, o
//     mesmo botão passa a mandar de verdade. "Nota interna" o lead nunca vê.
//   - A lista e a conversa aberta se atualizam sozinhas (a cada 8 s e ao voltar
//     para a aba), como o funil de Leads.
import { A1, A1_URL } from '../../shared/api/config.js';
import { esc } from '../../shared/utils/texto.js';
import { a1RequireAuth, a1RequireModule, a1StartHeartbeat } from '../../shared/auth/auth.js';
import { a1MontarShell } from '../../shared/ui/modulo-shell.js';
import '../../shared/ui/avisos.js';
import { acoes } from '../../shared/ui/acoes.js';
import { canalDoLead, seloCanal } from '../../shared/ui/canal-origem.js';

const AO_VIVO_MS = 8000;
const G = {
  user: /** @type {any} */ (null),
  gestor: false,
  conversas: /** @type {any[]} */ ([]),
  leads: /** @type {Record<string, any>} */ ({}),
  msgs: /** @type {any[]} */ ([]),
  aberta: /** @type {string|null} */ (null),
  aba: 'fila',
  modo: 'humano',
  tipo: 'mensagem',
  busca: '',
  proximo: /** @type {string|null} */ (null),
  motivos: /** @type {string[]} */ ([]),
  desqualificando: false,
  qualDirty: false,
  qualVersao: /** @type {number|null} */ (null),
  enviando: false,
  // WhatsApp da empresa (Evolution). Desligado: a mensagem abre no wa.me.
  wa: /** @type {{ligado:boolean, pausado_ate?:string|null, pausa_motivo?:string|null}} */ ({ ligado: false })
};
const $ = (/** @type {string} */ id) => /** @type {HTMLElement} */ (document.getElementById(id));

acoes({
  atModo: el => {
    if (G.qualDirty)
      return aviso('Salve ou cancele os dados de qualificação antes de trocar de lista.', 'erro');
    G.modo = el.dataset.modo === 'elia' ? 'elia' : 'humano';
    G.aba = G.modo === 'elia' ? 'todas' : G.gestor ? 'fila' : 'distribuidas';
    const atual = conversaAberta();
    if (atual && Boolean(atual.elia_ativa) !== (G.modo === 'elia')) {
      G.aberta = null;
      $('at-conversa').hidden = true;
      $('at-lead').hidden = true;
      $('at-vazio').hidden = false;
      document.body.classList.remove('at-com-conversa', 'at-painel-aberto');
    }
    desenharLista();
  },
  atAba: el => {
    G.aba = el.dataset.aba || 'fila';
    desenharLista();
  },
  atFiltrar: el => {
    G.busca = /** @type {HTMLInputElement} */ (el).value.trim().toLowerCase();
    desenharLista();
  },
  atAbrir: el => abrirConversa(el.dataset.id || ''),
  atVoltar: () => {
    if (G.qualDirty) return aviso('Salve ou cancele os dados de qualificação antes de sair.', 'erro');
    G.aberta = null;
    document.body.classList.remove('at-com-conversa');
    desenharLista();
  },
  atTipo: el => escolherTipo(el.dataset.tipo || 'mensagem'),
  atAutoAltura: el => {
    el.style.height = 'auto';
    el.style.height = Math.min(el.scrollHeight, 160) + 'px';
  },
  atEnviar: () => enviar(),
  // Em tela estreita o painel do lead vira gaveta por cima da conversa.
  atPainel: () => document.body.classList.toggle('at-painel-aberto'),
  atDistribuir: () => abrirVinculo(),
  atArquivo: () => $('at-arquivo').click(),
  atElia: el => trocarElia(el),
  atQualEdicao: () => {
    G.qualDirty = true;
  },
  atQualSalvar: () => salvarQualificacao(),
  atQualCancelar: () => {
    G.qualDirty = false;
    desenharLead();
  },
  atDesqualificar: () => {
    if (G.qualDirty) return aviso('Salve ou cancele os dados de qualificação antes de continuar.', 'erro');
    G.desqualificando = !G.desqualificando;
    desenharLead();
  },
  atConfirmarDesq: () => finalizar('desqualificado')
});

// Enter manda, Shift+Enter quebra a linha (como no WhatsApp).
document.addEventListener('keydown', ev => {
  const t = /** @type {HTMLElement} */ (ev.target);
  if (t && t.id === 'at-texto' && ev.key === 'Enter' && !ev.shiftKey && !ev.isComposing) {
    ev.preventDefault();
    enviar();
  }
});

// ─── Leitura ─────────────────────────────────────────────────────────────────
const COLUNAS_CONVERSA =
  'id,case_id,canal,status,pendente,corretor_nome,resultado,finalizado_por,finalizado_em,ultima_em,ultima_previa,versao,criado_em,elia_ativa';
const COLUNAS_LEAD =
  'id,client_name,client_phone,client_email,client_cpf,development,partner_name,stage_name,broker_name,real_estate_name,observations,payload,created_at';

async function lerConversas() {
  const r = await A1.buscarTudo(
    `${A1.rest('a1_atendimentos')}?select=${COLUNAS_CONVERSA}&order=ultima_em.desc`
  );
  const lista = (r && r.linhas) || [];
  const faltam = [...new Set(lista.map(c => c.case_id))].filter(Boolean);
  // Lê os leads de 100 em 100: um in.(...) gigante estoura o limite de URL.
  for (let i = 0; i < faltam.length; i += 100) {
    const ids = faltam.slice(i, i + 100).join(',');
    const leads = await fetch(`${A1.rest('a1_cases')}?id=in.(${ids})&select=${COLUNAS_LEAD}`, {
      headers: A1.headers()
    })
      .then(x => (x.ok ? x.json() : []))
      .catch(() => []);
    for (const l of Array.isArray(leads) ? leads : []) G.leads[l.id] = l;
  }
  G.conversas = lista;
}

async function lerMensagens(id) {
  const r = await fetch(
    `${A1.rest('a1_atendimento_mensagens')}?atendimento_id=eq.${encodeURIComponent(id)}&select=id,autor_tipo,autor_nome,tipo,corpo,criado_em&order=criado_em.asc`,
    { headers: A1.headers() }
  )
    .then(x => (x.ok ? x.json() : []))
    .catch(() => []);
  return Array.isArray(r) ? r : [];
}

async function lerProximo() {
  if (!G.gestor) return;
  G.proximo = await fetch(A1.rpc('a1_roleta_proximo_nome'), {
    method: 'POST',
    headers: A1.headers(),
    body: '{}'
  })
    .then(x => (x.ok ? x.json() : null))
    .catch(() => null);
}

async function lerMotivos() {
  const rows = await fetch(`${A1.rest('a1_config')}?key=eq.crm_cad_motivos_perda&select=value`, {
    headers: A1.headers()
  })
    .then(x => (x.ok ? x.json() : []))
    .catch(() => []);
  try {
    const lista = JSON.parse((rows && rows[0] && rows[0].value) || '[]');
    G.motivos = (Array.isArray(lista) ? lista : [])
      .filter(m => m && m.name && m.active !== false)
      .map(m => m.name);
  } catch {
    G.motivos = [];
  }
}

// ─── Formatação ──────────────────────────────────────────────────────────────
const ICONE_CANAL = {
  whatsapp:
    '<svg viewBox="0 0 24 24" width="11" height="11" aria-hidden="true"><path fill="currentColor" d="M12 2a10 10 0 0 0-8.6 15.1L2 22l5-1.3A10 10 0 1 0 12 2zm5.4 13.9c-.2.6-1.3 1.2-1.8 1.2-.5.1-1 .2-3.3-.7-2.8-1.1-4.6-4-4.7-4.2-.1-.2-1.1-1.5-1.1-2.8s.7-2 1-2.3c.2-.3.5-.3.7-.3h.5c.2 0 .4 0 .6.5l.9 2.1c.1.2.1.4 0 .6l-.4.6-.4.4c-.1.2-.3.3-.1.6.2.3.8 1.3 1.6 2.1 1.1 1 2 1.3 2.3 1.4.3.2.5.1.6 0l.9-1c.2-.3.4-.2.7-.1l2 .9c.3.2.5.2.6.4.1.1.1.7-.2 1.4z"/></svg>'
};
const CORES = ['#0e8c7f', '#3f6f9e', '#b5651d', '#7c4dff', '#c2185b', '#2e7d32', '#00838f', '#6d4c41'];
function corDo(/** @type {string} */ s) {
  let h = 0;
  for (const ch of String(s || '')) h = (h * 31 + ch.charCodeAt(0)) >>> 0;
  return CORES[h % CORES.length];
}
function iniciais(/** @type {string} */ nome) {
  const p = String(nome || '?')
    .replace(/[^\p{L}\s]/gu, ' ')
    .trim()
    .split(/\s+/)
    .filter(Boolean);
  return ((p[0] || '?')[0] + (p.length > 1 ? p[p.length - 1][0] : '')).toUpperCase();
}
function quandoCurto(/** @type {string} */ iso) {
  if (!iso) return '';
  const d = new Date(iso);
  const s = (Date.now() - d.getTime()) / 1000;
  if (s < 60) return 'Agora';
  if (s < 3600) return `${Math.floor(s / 60)} min`;
  const hoje = new Date();
  if (d.toDateString() === hoje.toDateString())
    return d.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' });
  const ontem = new Date(hoje.getTime() - 86400000);
  if (d.toDateString() === ontem.toDateString()) return 'Ontem';
  return d.toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit' });
}
const hora = (/** @type {string} */ iso) =>
  iso ? new Date(iso).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' }) : '';
const dia = (/** @type {string} */ iso) => {
  const d = new Date(iso);
  const hoje = new Date();
  if (d.toDateString() === hoje.toDateString()) return 'Hoje';
  if (d.toDateString() === new Date(hoje.getTime() - 86400000).toDateString()) return 'Ontem';
  return d.toLocaleDateString('pt-BR', { day: '2-digit', month: 'long', year: 'numeric' });
};
const soDigitos = (/** @type {string} */ t) => String(t || '').replace(/\D/g, '');

// O canal vem do lead (a Meta diz se foi Instagram ou Facebook); sem o lead
// carregado, vale o canal da conversa.
function canalDe(/** @type {any} */ c, /** @type {any} */ l) {
  if ((l && l.payload && l.payload.integracao) || !c.canal || c.canal === 'manual') return canalDoLead(l);
  return canalDoLead({ payload: { integracao: { origem: c.canal } } });
}

function avatar(/** @type {any} */ c, /** @type {any} */ l, tam = 46) {
  const nome = (l && l.client_name) || 'Lead';
  return `<span class="at-av" style="--av:${corDo(nome)};width:${tam}px;height:${tam}px">${esc(iniciais(nome))}
    <i class="at-av-canal">${seloCanal(canalDe(c, l), 18)}</i></span>`;
}

// ─── Lista ───────────────────────────────────────────────────────────────────
const ABAS = [
  { k: 'fila', rot: 'Na fila', so: c => c.status === 'aberta', gestor: true },
  { k: 'distribuidas', rot: 'Com corretor', so: c => c.status === 'distribuida' },
  { k: 'encerradas', rot: 'Encerradas', so: c => c.status === 'encerrada' },
  { k: 'todas', rot: 'Todas', so: () => true }
];

function desenharLista() {
  for (const modo of ['elia', 'humano']) {
    const botao = $('at-' + modo);
    botao.classList.toggle('ativo', G.modo === modo);
    botao.setAttribute('aria-pressed', String(G.modo === modo));
  }
  const conversas = G.conversas.filter(c => Boolean(c.elia_ativa) === (G.modo === 'elia'));
  const abas = ABAS.filter(a => G.gestor || !a.gestor);
  if (!abas.some(a => a.k === G.aba)) G.aba = abas[0].k;
  $('at-abas').innerHTML = abas
    .map(a => {
      const n = conversas.filter(a.so).length;
      return `<button type="button" role="tab" class="at-aba${a.k === G.aba ? ' ativo' : ''}" aria-selected="${a.k === G.aba}"
        data-acao="atAba" data-aba="${a.k}">${esc(a.rot)}<span>${n}</span></button>`;
    })
    .join('');
  const aba = abas.find(a => a.k === G.aba) || abas[0];
  const lista = conversas.filter(aba.so).filter(c => {
    if (!G.busca) return true;
    const l = G.leads[c.case_id] || {};
    return [l.client_name, l.client_phone, l.client_email, c.ultima_previa, c.corretor_nome]
      .filter(Boolean)
      .some(x => String(x).toLowerCase().includes(G.busca));
  });
  $('at-itens').innerHTML = lista.length
    ? lista
        .map(c => {
          const l = G.leads[c.case_id] || {};
          const status =
            c.status === 'distribuida'
              ? `<span class="at-item-st st-corretor">${esc(c.corretor_nome || 'Corretor')}</span>`
              : c.status === 'encerrada'
                ? '<span class="at-item-st st-encerrada">Encerrada</span>'
                : '';
          return `<button type="button" class="at-item${c.id === G.aberta ? ' ativo' : ''}" data-acao="atAbrir" data-id="${esc(c.id)}">
            ${avatar(c, l)}
            <span class="at-item-txt">
              <span class="at-item-l1"><b>${esc(l.client_name || 'Lead')}</b><time>${esc(quandoCurto(c.ultima_em))}</time></span>
              <span class="at-item-l2"><span class="at-item-prev">${esc(c.ultima_previa || '')}</span>${c.pendente ? '<span class="at-novo">Novo</span>' : ''}</span>
              ${status}
            </span>
          </button>`;
        })
        .join('')
    : `<p class="at-lista-vazia">${G.busca ? 'Nenhuma conversa com esse termo.' : aba.k === 'fila' ? 'Fila vazia. Os leads dos anúncios chegam aqui sozinhos.' : 'Nenhuma conversa aqui.'}</p>`;
}

// ─── Conversa ────────────────────────────────────────────────────────────────
function conversaAberta() {
  return G.conversas.find(c => c.id === G.aberta) || null;
}

async function abrirConversa(id) {
  if (G.qualDirty && G.aberta !== id)
    return aviso('Salve ou cancele os dados de qualificação antes de trocar de conversa.', 'erro');
  G.aberta = id;
  G.desqualificando = false;
  G.qualDirty = false;
  document.body.classList.remove('at-painel-aberto');
  document.body.classList.add('at-com-conversa');
  desenharLista();
  const c = conversaAberta();
  if (!c) return;
  $('at-vazio').hidden = true;
  $('at-conversa').hidden = false;
  $('at-lead').hidden = false;
  desenharCabecalho();
  desenharLead();
  $('at-msgs').innerHTML = '<div class="at-carregando">Carregando conversa…</div>';
  G.msgs = await lerMensagens(id);
  if (G.aberta !== id) return;
  desenharMensagens(true);
  escolherTipo(G.tipo);
}

function desenharCabecalho() {
  const c = conversaAberta();
  if (!c) return;
  const l = G.leads[c.case_id] || {};
  const tel = soDigitos(l.client_phone);
  const canal = canalDe(c, l);
  $('at-chat-cab').innerHTML = `
    <button type="button" class="at-voltar" data-acao="atVoltar" aria-label="Voltar para a lista">
      <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="m15 18-6-6 6-6"/></svg></button>
    ${avatar(c, l, 40)}
    <div class="at-chat-quem"><b>${esc(l.client_name || 'Lead')}</b>
      <small>${esc([l.client_phone, canal.rot].filter(Boolean).join(' · '))}</small></div>
    <div class="at-chat-acoes">
      <button type="button" class="at-btn-ic at-so-estreito" data-acao="atPainel" title="Dados do lead e qualificação" aria-label="Dados do lead e qualificação">
        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><circle cx="12" cy="12" r="9"/><path d="M12 11v5M12 8h.01"/></svg></button>
      ${tel ? `<a class="at-btn-ic" href="https://wa.me/${esc(tel.length <= 11 ? '55' + tel : tel)}" target="_blank" rel="noopener noreferrer" title="Abrir no WhatsApp">${ICONE_CANAL.whatsapp.replace(/width="11" height="11"/, 'width="18" height="18"')}</a>` : ''}
      <a class="at-btn-ic" href="/${esc(A1.slug || '')}/crm" title="Abrir o funil de Leads">
        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><rect x="3" y="4" width="5" height="16" rx="1.5"/><rect x="10" y="4" width="5" height="10" rx="1.5"/><rect x="17" y="4" width="4" height="7" rx="1.5"/></svg></a>
    </div>`;
}

function bolha(/** @type {any} */ m) {
  if (m.tipo === 'evento' || m.autor_tipo === 'sistema')
    return `<div class="at-evento"><span>${esc(m.corpo)}</span><time>${esc(hora(m.criado_em))}</time></div>`;
  if (m.tipo === 'nota')
    return `<div class="at-msg at-nota"><div class="at-msg-rot">Nota interna · ${esc(m.autor_nome || '')}</div>${esc(m.corpo)}<time>${esc(hora(m.criado_em))}</time></div>`;
  const minha = m.autor_tipo === 'atendente' || m.autor_tipo === 'ia';
  return `<div class="at-msg ${minha ? 'at-sai' : 'at-entra'}">${minha ? `<div class="at-msg-rot">${m.autor_tipo === 'ia' ? 'ELIA · agente de IA' : esc(m.autor_nome || '')}</div>` : ''}${esc(m.corpo)}<time>${esc(hora(m.criado_em))}${minha ? ' <span class="at-vistos" aria-hidden="true">✓✓</span>' : ''}</time></div>`;
}

function desenharMensagens(rolar = false) {
  const area = $('at-msgs');
  const noFim = area.scrollHeight - area.scrollTop - area.clientHeight < 60;
  let ultimoDia = '';
  area.innerHTML = G.msgs
    .map(m => {
      const d = dia(m.criado_em);
      const sep = d !== ultimoDia ? `<div class="at-dia"><span>${esc(d)}</span></div>` : '';
      ultimoDia = d;
      return sep + bolha(m);
    })
    .join('');
  if (rolar || noFim) area.scrollTop = area.scrollHeight;
}

function podeEscrever(/** @type {any} */ c) {
  if (!c || c.status === 'encerrada') return false;
  return G.gestor || c.status === 'distribuida';
}

function escolherTipo(/** @type {string} */ t) {
  G.tipo = t === 'nota' ? 'nota' : 'mensagem';
  document.querySelectorAll('.at-compor-tipo button').forEach(b => {
    b.classList.toggle('ativo', /** @type {HTMLElement} */ (b).dataset.tipo === G.tipo);
    b.setAttribute('aria-selected', String(/** @type {HTMLElement} */ (b).dataset.tipo === G.tipo));
  });
  const c = conversaAberta();
  const l = c ? G.leads[c.case_id] || {} : {};
  const caixa = /** @type {HTMLTextAreaElement} */ ($('at-texto'));
  const pode = podeEscrever(c);
  const whatsapp = G.wa.ligado && Boolean(soDigitos(l.client_phone));
  $('at-compor-clipe').hidden = !(G.tipo === 'mensagem' && pode && whatsapp);
  $('at-chat-vincular').hidden = !(c && G.gestor && c.status !== 'encerrada');
  const elia = $('at-chat-elia');
  elia.hidden = !(c && G.gestor && (c.elia_ativa || whatsapp));
  elia.setAttribute('aria-pressed', String(Boolean(c?.elia_ativa)));
  const tituloElia = c?.elia_ativa ? 'ELIA ativa · Retomar' : 'Atendimento ELIA';
  if (elia.textContent !== tituloElia) elia.textContent = tituloElia;
  $('at-compor').classList.toggle('nota', G.tipo === 'nota');
  caixa.disabled = !pode;
  /** @type {HTMLButtonElement} */ ($('at-enviar')).disabled = !pode;
  caixa.placeholder = !pode
    ? c && c.status === 'encerrada'
      ? 'Conversa encerrada'
      : 'Só o gestor conversa com leads da fila'
    : G.tipo === 'nota'
      ? 'Nota interna: só a equipe vê'
      : 'Digite uma mensagem';
  $('at-compor-aviso').textContent =
    !pode || G.tipo === 'nota'
      ? ''
      : !soDigitos(l.client_phone)
        ? 'Este lead não tem telefone. Registre o contato como nota interna.'
        : G.wa.ligado && G.wa.pausado_ate
          ? `Envios pelo WhatsApp pausados até ${hora(G.wa.pausado_ate)} para proteger o número. ${G.wa.pausa_motivo || ''}`.trim()
          : G.wa.ligado
            ? 'A mensagem sai pelo WhatsApp da empresa.'
            : 'WhatsApp ainda não integrado: ao enviar, a conversa abre no WhatsApp com o texto e a mensagem fica registrada aqui.';
}

async function enviar() {
  const c = conversaAberta();
  const caixa = /** @type {HTMLTextAreaElement} */ ($('at-texto'));
  const texto = caixa.value.trim();
  if (!c || !texto || G.enviando || !podeEscrever(c)) return;
  const l = G.leads[c.case_id] || {};
  const tel = soDigitos(l.client_phone);
  if (G.tipo === 'mensagem' && !tel) {
    aviso('Este lead não tem telefone. Use a nota interna para registrar o contato.', 'erro');
    return;
  }
  G.enviando = true;
  if (G.tipo === 'mensagem' && G.wa.ligado) {
    try {
      await enviarPeloWhatsapp(c.id, texto);
      caixa.value = '';
      caixa.style.height = 'auto';
      G.msgs = await lerMensagens(c.id);
      desenharMensagens(true);
      await atualizar();
    } catch (e) {
      aviso(/** @type {Error} */ (e).message, 'erro');
    } finally {
      G.enviando = false;
    }
    return;
  }
  // Abre o WhatsApp na hora do clique: depois de um await, o navegador trata a
  // janela nova como pop-up não pedido e bloqueia.
  if (G.tipo === 'mensagem')
    window.open(
      `https://wa.me/${tel.length <= 11 ? '55' + tel : tel}?text=${encodeURIComponent(texto)}`,
      '_blank',
      'noopener'
    );
  try {
    const r = await fetch(A1.rpc('a1_atend_enviar'), {
      method: 'POST',
      headers: A1.headers(),
      body: JSON.stringify({ p_atendimento: c.id, p_tipo: G.tipo, p_corpo: texto })
    });
    if (!r.ok) throw new Error(await motivo(r));
    caixa.value = '';
    caixa.style.height = 'auto';
    G.msgs = await lerMensagens(c.id);
    desenharMensagens(true);
    await atualizar();
  } catch (e) {
    aviso(/** @type {Error} */ (e).message, 'erro');
  } finally {
    G.enviando = false;
  }
}

// Envio de verdade pelo WhatsApp da empresa: a função confere a posse da
// conversa, os limites anti-bloqueio e grava a mensagem com o id do WhatsApp.
const ERROS_WA = /** @type {Record<string,string>} */ ({
  whatsapp_desconectado:
    'O WhatsApp da empresa está desconectado. Peça ao gestor para conectar em Configurações › Integrações.',
  sem_permissao: 'Você não pode responder nesta conversa.',
  conversa_encerrada: 'Conversa encerrada.',
  sem_telefone: 'Este lead não tem telefone.',
  anexo_invalido: 'Envie PDF, JPG, PNG, WebP, DOCX ou XLSX de até 5 MB, com legenda de até 900 caracteres.',
  falha_envio: 'O WhatsApp não aceitou a mensagem agora. Tente de novo em instantes.'
});
async function enviarPeloWhatsapp(
  /** @type {string} */ id,
  /** @type {string} */ texto,
  /** @type {{nome:string,mime:string,dados:string}|null} */ anexo = null
) {
  /** @type {Response} */
  let r;
  try {
    r = await fetch(`${A1_URL}/functions/v1/atendimento-conectores`, {
      method: 'POST',
      headers: A1.headers(),
      body: JSON.stringify({ action: anexo ? 'wa_anexo' : 'wa_enviar', atendimento_id: id, texto, anexo }),
      signal: AbortSignal.timeout(30000)
    });
  } catch {
    throw new Error('Não foi possível falar com o WhatsApp agora. Confira a internet e tente de novo.');
  }
  const b = await r.json().catch(() => ({}));
  if (r.status === 429) {
    G.wa = { ...G.wa, pausado_ate: b.volta_em || null, pausa_motivo: b.motivo || null };
    escolherTipo(G.tipo);
    throw new Error(
      `${b.motivo || 'Limite de envio atingido.'}${b.volta_em ? ` Volta às ${hora(b.volta_em)}.` : ''}`
    );
  }
  if (!r.ok) throw new Error(ERROS_WA[b.error] || 'Não foi possível enviar agora. Tente de novo.');
  if (b.alerta) aviso('Atenção: o número está perto do limite seguro de envios. Vá com calma.', 'erro');
}

async function lerWhatsapp() {
  try {
    const r = await fetch(A1.rpc('a1_wa_ligado'), { method: 'POST', headers: A1.headers(), body: '{}' });
    const b = r.ok ? await r.json() : null;
    G.wa =
      b && typeof b === 'object'
        ? {
            ligado: b.ligado === true,
            pausado_ate: b.pausado_ate || null,
            pausa_motivo: b.pausa_motivo || null
          }
        : { ligado: false };
  } catch {
    G.wa = { ligado: false };
  }
}

// ─── Dados do lead e ações ───────────────────────────────────────────────────
function respostasDo(/** @type {any} */ l) {
  const dados = (l.payload && l.payload.integracao && l.payload.integracao.dados) || {};
  return Array.isArray(dados.respostas) ? dados.respostas.filter(r => r && r.pergunta) : [];
}

function desenharLead() {
  const c = conversaAberta();
  const alvo = $('at-lead');
  if (!c) {
    alvo.hidden = true;
    return;
  }
  const l = G.leads[c.case_id] || {};
  G.qualVersao = c.versao;
  const dados = (l.payload && l.payload.integracao && l.payload.integracao.dados) || {};
  const resp = respostasDo(l);
  const qual = l.payload?.qualificacao || {};
  const valores = {
    ...qual,
    nome: l.client_name || '',
    telefone: l.client_phone || '',
    email: l.client_email || '',
    cpf: l.client_cpf || '',
    empreendimento: qual.empreendimento || l.development || ''
  };
  const campos = [
    ['nome', 'Nome'],
    ['telefone', 'Telefone'],
    ['email', 'E-mail'],
    ['cpf', 'CPF'],
    ['empreendimento', 'Empreendimento'],
    ['renda', 'Renda familiar'],
    ['cidade', 'Cidade de interesse'],
    ['tipo_imovel', 'Tipo de imóvel'],
    ['quartos', 'Quartos'],
    ['orcamento', 'Orçamento'],
    ['prazo', 'Prazo de compra'],
    ['observacoes', 'Observações']
  ];
  const qualificacao = `<section class="at-bloco"><h3>Dados de qualificação</h3>
    <p class="at-qual-ajuda">${c.elia_ativa ? 'A ELIA preenche os dados informados durante a conversa.' : 'Preencha os dados informados pelo lead.'}</p>
    <div class="at-qual-campos">${campos.map(([key, label]) => `<label>${esc(label)}<input data-qual="${key}" data-original="${esc(valores[key] || '')}" data-acao-input="atQualEdicao" maxlength="${key === 'observacoes' ? 500 : 255}" value="${esc(valores[key] || '')}" ${c.elia_ativa ? 'disabled' : ''}></label>`).join('')}</div>
    ${c.elia_ativa ? '' : '<div class="at-qual-botoes"><button type="button" class="at-btn at-btn-forte" data-acao="atQualSalvar">Salvar dados</button><button type="button" class="at-btn at-btn-linha" data-acao="atQualCancelar">Cancelar</button></div>'}
    </section>`;
  const linha = (rot, val) =>
    val ? `<div class="at-dado"><span>${esc(rot)}</span><b>${esc(val)}</b></div>` : '';
  const acoes =
    G.gestor && c.status === 'aberta'
      ? `<section class="at-bloco at-acoes">
          <h3>Qualificação</h3>
          <button type="button" class="at-btn at-btn-forte" data-acao="atDistribuir">Qualificado: vincular a corretor</button>
          <p class="at-proximo">${G.proximo ? `Próximo da vez: <b>${esc(G.proximo)}</b>` : 'A roleta está vazia. Escolha os corretores em Configurações › Leads › Roleta de distribuição.'}</p>
          <button type="button" class="at-btn at-btn-linha" data-acao="atDesqualificar" aria-expanded="${G.desqualificando}">Desqualificar</button>
          ${
            G.desqualificando
              ? `<div class="at-desq">
                  ${
                    G.motivos.length
                      ? `<label for="at-motivo">Motivo</label><select id="at-motivo"><option value="">Escolha…</option>${G.motivos.map(m => `<option>${esc(m)}</option>`).join('')}</select>`
                      : ''
                  }
                  <label for="at-obs">${G.motivos.length ? 'Observação' : 'Motivo'}</label>
                  <textarea id="at-obs" rows="2" placeholder="Ex.: renda abaixo do mínimo"></textarea>
                  <button type="button" class="at-btn at-btn-perigo" data-acao="atConfirmarDesq">Confirmar: mover para Perdido</button>
                </div>`
              : ''
          }
        </section>`
      : c.status !== 'aberta'
        ? `<section class="at-bloco"><h3>Resultado</h3>
            <p class="at-resultado ${c.resultado === 'qualificado' ? 'ok' : 'nao'}">${c.resultado === 'qualificado' ? `Qualificado e distribuído para <b>${esc(c.corretor_nome || '')}</b>` : 'Desqualificado: o lead foi para Perdido'}</p>
            ${c.finalizado_por ? `<small class="at-quem">por ${esc(c.finalizado_por)} · ${esc(quandoCurto(c.finalizado_em))}</small>` : ''}
          </section>`
        : '';
  alvo.innerHTML = `
    <section class="at-bloco at-perfil">
      ${avatar(c, l, 64)}
      <h2>${esc(l.client_name || 'Lead')}</h2>
      <p>${esc(l.partner_name || canalDe(c, l).rot)}</p>
    </section>
    ${acoes}
    ${qualificacao}
    <section class="at-bloco">
      <h3>Contato</h3>
      ${linha('Telefone', l.client_phone)}${linha('E-mail', l.client_email)}
      ${linha('Etapa no funil', l.stage_name)}${linha('Corretor', l.broker_name)}${linha('Imobiliária', l.real_estate_name)}
    </section>
    ${
      dados.campanha || dados.formulario_nome || dados.anuncio
        ? `<section class="at-bloco"><h3>Origem</h3>
            ${linha('Formulário', dados.formulario_nome)}${linha('Campanha', dados.campanha)}${linha('Conjunto', dados.conjunto)}${linha('Anúncio', dados.anuncio)}
          </section>`
        : ''
    }
    ${
      resp.length
        ? `<section class="at-bloco"><h3>Respostas do formulário</h3>${resp.map(r => linha(r.pergunta, r.resposta)).join('')}</section>`
        : ''
    }`;
}

async function salvarQualificacao() {
  const c = conversaAberta();
  if (!c || c.elia_ativa) return;
  const dados = {};
  document.querySelectorAll('#at-lead [data-qual]').forEach(el => {
    if (el.value.trim() !== (el.dataset.original || '').trim()) dados[el.dataset.qual] = el.value.trim();
  });
  if (!Object.keys(dados).length) {
    G.qualDirty = false;
    desenharLead();
    return;
  }
  try {
    await acaoConversa('a1_atend_qualificacao_manual', {
      p_atendimento: c.id,
      p_versao: G.qualVersao,
      p_dados: dados
    });
    G.qualDirty = false;
    await atualizar();
    aviso('Dados de qualificação salvos.', 'ok');
  } catch (error) {
    aviso(error.message || 'Não foi possível salvar os dados.', 'erro');
  }
}

let alvoVinculo = null;

async function abrirVinculo() {
  if (G.qualDirty) return aviso('Salve ou cancele os dados de qualificação antes de vincular.', 'erro');
  const conversa = conversaAberta();
  const dialog = /** @type {HTMLDialogElement} */ ($('at-vincular'));
  if (!conversa || dialog.open) return;
  alvoVinculo = conversa;
  const select = /** @type {HTMLSelectElement} */ ($('at-escolher-corretor'));
  const erro = $('at-vincular-erro');
  const confirmar = /** @type {HTMLButtonElement} */ (dialog.querySelector('[value="vincular"]'));
  confirmar.disabled = true;
  select.innerHTML = '';
  erro.textContent = 'Carregando corretores…';
  dialog.showModal();
  try {
    const corretores = await acaoConversa('a1_atend_corretores', {});
    if (alvoVinculo !== conversa || !dialog.open) return;
    select.append(new Option('Escolha como vincular', ''));
    const roleta = new Option(
      G.proximo ? `Fila de distribuição · ${G.proximo}` : 'Fila de distribuição · sem corretores',
      'roleta'
    );
    roleta.disabled = !G.proximo;
    select.append(roleta);
    for (const corretor of corretores) select.append(new Option(corretor.name, corretor.id));
    erro.textContent = '';
    confirmar.disabled = false;
  } catch (error) {
    erro.textContent = error.message;
  }
}

async function acaoConversa(nome, dados) {
  const resposta = await fetch(A1.rpc(nome), {
    method: 'POST',
    headers: A1.headers(),
    body: JSON.stringify(dados)
  });
  if (!resposta.ok) throw Error(await motivo(resposta));
  const corpo = await resposta.text();
  return corpo ? JSON.parse(corpo) : null;
}

$('at-vincular').addEventListener('submit', async event => {
  const submit = /** @type {SubmitEvent} */ (event);
  if (submit.submitter?.getAttribute('value') !== 'vincular') return;
  event.preventDefault();
  const button = /** @type {HTMLButtonElement} */ (submit.submitter);
  const dialog = /** @type {HTMLDialogElement} */ ($('at-vincular'));
  const conversa = alvoVinculo;
  const escolha = /** @type {HTMLSelectElement} */ ($('at-escolher-corretor')).value;
  if (!conversa || !escolha || button.disabled) return;
  button.disabled = true;
  try {
    const dados = await acaoConversa('a1_atend_finalizar_com_corretor', {
      p_atendimento: conversa.id,
      p_versao: conversa.versao,
      p_resultado: 'qualificado',
      p_motivo: null,
      p_obs: null,
      p_corretor: escolha === 'roleta' ? null : escolha
    });
    dialog.close();
    await atualizar();
    aviso(`Lead vinculado a ${dados.corretor}.`, 'ok');
  } catch (error) {
    $('at-vincular-erro').textContent = error.message;
  } finally {
    button.disabled = false;
  }
});

async function trocarElia(elemento) {
  const conversa = conversaAberta();
  if (!conversa || elemento.disabled) return;
  if (G.qualDirty)
    return aviso('Salve ou cancele os dados de qualificação antes de transferir o atendimento.', 'erro');
  const ativa = !conversa.elia_ativa;
  if (
    ativa &&
    conversa.status === 'distribuida' &&
    !window.confirm('Retirar o corretor e devolver esta conversa à ELIA para qualificação?')
  )
    return;
  elemento.disabled = true;
  try {
    await acaoConversa('a1_atend_elia', {
      p_atendimento: conversa.id,
      p_versao: conversa.versao,
      p_ativa: ativa
    });
    G.modo = ativa ? 'elia' : 'humano';
    await atualizar();
    aviso(ativa ? 'Conversa encaminhada à ELIA.' : 'Conversa retomada pela equipe.', 'ok');
  } catch (error) {
    aviso(error.message, 'erro');
  } finally {
    elemento.disabled = false;
  }
}

$('at-arquivo').addEventListener('change', async event => {
  const input = /** @type {HTMLInputElement} */ (event.currentTarget);
  const file = input.files?.[0];
  input.value = '';
  const conversa = conversaAberta();
  if (!file || !conversa || !podeEscrever(conversa) || G.enviando) return;
  if (!file.size || file.size > 5242880) return aviso('Escolha um arquivo de até 5 MB.', 'erro');
  const mime =
    file.type ||
    {
      pdf: 'application/pdf',
      docx: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
      xlsx: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
    }[file.name.split('.').pop()?.toLowerCase()];
  if (!mime) return aviso('Formato de arquivo não identificado.', 'erro');
  if (!window.confirm(`Enviar ${file.name} ao lead desta conversa pelo WhatsApp?`)) return;
  G.enviando = true;
  try {
    const dados = await new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(String(reader.result).split(',')[1]);
      reader.onerror = () => reject(Error('Não foi possível ler o arquivo.'));
      reader.readAsDataURL(file);
    });
    await enviarPeloWhatsapp(conversa.id, '', { nome: file.name, mime, dados });
    await atualizar();
    if (G.aberta === conversa.id) {
      G.msgs = await lerMensagens(conversa.id);
      if (G.aberta === conversa.id) desenharMensagens(true);
    }
    aviso('Arquivo enviado pelo WhatsApp.', 'ok');
  } catch (error) {
    aviso(error.message, 'erro');
  } finally {
    G.enviando = false;
  }
});

async function finalizar(/** @type {'qualificado'|'desqualificado'} */ resultado) {
  const c = conversaAberta();
  if (!c || !G.gestor) return;
  let motivoSel = '';
  let obs = '';
  if (resultado === 'desqualificado') {
    motivoSel = /** @type {HTMLSelectElement|null} */ (document.getElementById('at-motivo'))?.value || '';
    obs = /** @type {HTMLTextAreaElement|null} */ (document.getElementById('at-obs'))?.value.trim() || '';
    if (G.motivos.length && !motivoSel) return aviso('Escolha o motivo da desqualificação.', 'erro');
    if (!motivoSel && !obs) return aviso('Conte por que o lead foi desqualificado.', 'erro');
  }
  document
    .querySelectorAll('#at-lead .at-btn')
    .forEach(b => /** @type {HTMLButtonElement} */ (b.disabled = true));
  try {
    const r = await fetch(A1.rpc('a1_atend_finalizar'), {
      method: 'POST',
      headers: A1.headers(),
      body: JSON.stringify({
        p_atendimento: c.id,
        p_resultado: resultado,
        p_versao: c.versao,
        p_motivo: motivoSel || null,
        p_obs: obs || null
      })
    });
    if (!r.ok) throw new Error(await motivo(r));
    const d = await r.json().catch(() => ({}));
    aviso(
      resultado === 'qualificado'
        ? `Lead distribuído para ${d.corretor || 'o corretor da vez'}, na etapa ${d.etapa || 'Em atendimento'}.`
        : 'Lead desqualificado e movido para Perdido.',
      'ok'
    );
    G.desqualificando = false;
    await atualizar();
    G.msgs = await lerMensagens(c.id);
    desenharMensagens(true);
  } catch (e) {
    aviso(/** @type {Error} */ (e).message, 'erro');
    desenharLead();
  }
}

// ─── Erros do banco em português ─────────────────────────────────────────────
const ERROS = /** @type {Record<string,string>} */ ({
  sem_permissao: 'Você não pode fazer isso nesta conversa. Leads da fila só o gestor atende.',
  modulo_desabilitado: 'A Central de atendimento não está liberada para esta empresa.',
  roleta_vazia:
    'A roleta está vazia: escolha os corretores em Configurações › Leads › Roleta de distribuição.',
  versao_desatualizada:
    'Outra pessoa mexeu nesta conversa agora. A tela foi atualizada; confira e tente de novo.',
  ja_finalizada: 'Esta conversa já foi finalizada por outra pessoa.',
  corretor_indisponivel: 'O corretor selecionado não está disponível.',
  elia_nao_configurada: 'Ative a ELIA para o WhatsApp e salve um fluxo em Configurações › ELIA.',
  elia_canal_invalido: 'Não foi possível mudar o atendimento desta conversa.',
  elia_whatsapp_desconectado: 'Conecte o WhatsApp da empresa antes de ativar a ELIA.',
  elia_ativa: 'Retome a conversa com a equipe antes de editar a qualificação.',
  nome_invalido: 'Informe um nome válido para o lead.',
  email_invalido: 'Confira o e-mail informado.',
  cpf_invalido: 'Informe um CPF com 11 dígitos.',
  telefone_invalido: 'Informe um telefone com DDD.',
  sem_etapa_perdido: 'O funil deste lead não tem etapa com o selo Perdido. Marque uma no Editor de Workflow.',
  motivo_obrigatorio: 'Conte por que o lead foi desqualificado.',
  conversa_encerrada: 'Esta conversa está encerrada.',
  mensagem_invalida: 'A mensagem está vazia ou passou de 4.000 caracteres.',
  conversa_nao_encontrada: 'Conversa não encontrada.'
});
async function motivo(/** @type {Response} */ r) {
  const t = await r.text().catch(() => '');
  const chave = Object.keys(ERROS).find(k => t.includes(k));
  if (chave === 'versao_desatualizada') atualizar();
  return chave ? ERROS[chave] : 'Não foi possível concluir agora. Confira a conexão e tente de novo.';
}

function aviso(/** @type {string} */ msg, tipo = 'ok') {
  const d = document.createElement('div');
  d.className = `at-toast at-toast-${tipo}`;
  d.textContent = msg;
  $('at-toasts').appendChild(d);
  setTimeout(() => d.remove(), 4200);
}

// ─── Ao vivo ─────────────────────────────────────────────────────────────────
async function atualizar() {
  const anterior = conversaAberta();
  const eliaAnterior = anterior && Boolean(anterior.elia_ativa);
  const antes = new Set(G.conversas.filter(c => c.status === 'aberta').map(c => c.id));
  await Promise.all([lerConversas(), lerProximo()]);
  const atual = conversaAberta();
  if (atual && anterior && Boolean(atual.elia_ativa) !== eliaAnterior) {
    G.modo = atual.elia_ativa ? 'elia' : 'humano';
  }
  desenharLista();
  const novos = G.conversas.filter(c => c.status === 'aberta' && !antes.has(c.id));
  if (antes.size && novos.length && G.gestor) {
    const l = G.leads[novos[0].case_id] || {};
    aviso(
      novos.length === 1
        ? `Novo lead na fila: ${l.client_name || 'Lead'}`
        : `${novos.length} leads novos na fila`,
      'ok'
    );
  }
  if (G.aberta) {
    desenharCabecalho();
    const editando = document.activeElement?.closest('.at-qual-campos');
    if (!G.desqualificando && !G.qualDirty && !editando) desenharLead();
    escolherTipo(G.tipo);
  }
}

let tiques = 0;
async function tique() {
  if (document.hidden) return;
  await atualizar().catch(() => {});
  // o estado do WhatsApp (ligado, pausa) muda pouco: confere a cada ~40 s
  if (++tiques % 5 === 0) {
    const antes = JSON.stringify(G.wa);
    await lerWhatsapp();
    if (JSON.stringify(G.wa) !== antes && G.aberta) escolherTipo(G.tipo);
  }
  if (G.aberta) {
    const id = G.aberta;
    const msgs = await lerMensagens(id);
    if (G.aberta === id && msgs.length !== G.msgs.length) {
      G.msgs = msgs;
      desenharMensagens();
    }
  }
}

// ─── Início ──────────────────────────────────────────────────────────────────
async function init() {
  try {
    G.user = a1RequireAuth();
  } catch {
    return;
  }
  try {
    await a1RequireModule('crm');
    await a1RequireModule('ATENDIMENTO');
  } catch {
    return;
  }
  G.gestor = !!G.user && G.user.role !== 'partner';
  G.aba = G.gestor ? 'fila' : 'distribuidas';
  const slug = encodeURIComponent(A1.slug || '');
  await a1MontarShell(document.getElementById('sb-casco'), {
    ativo: 'crm',
    sub: [
      { rot: 'Central de atendimento', href: `/${slug}/atendimento`, ativo: true },
      { rot: 'Andamento', href: `/${slug}/crm` },
      { rot: 'Listagem', href: `/${slug}/crm?vista=listagem` },
      { rot: 'Dashboard', href: `/${slug}/crm?vista=dashboard` }
    ]
  });
  a1StartHeartbeat('atendimento');
  await Promise.all([lerConversas(), lerProximo(), G.gestor ? lerMotivos() : null, lerWhatsapp()]);
  desenharLista();
  const pedido = new URLSearchParams(location.search).get('conversa');
  if (pedido && G.conversas.some(c => c.id === pedido)) {
    G.modo = G.conversas.find(c => c.id === pedido).elia_ativa ? 'elia' : 'humano';
    abrirConversa(pedido);
  }
  setInterval(tique, AO_VIVO_MS);
  document.addEventListener('visibilitychange', () => {
    if (!document.hidden) tique();
  });
}

init();
