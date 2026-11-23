import { A1, A1_URL } from '../../shared/api/config.js';
import { esc } from '../../shared/utils/texto.js';
import { acoes } from '../../shared/ui/acoes.js';
import '../../shared/ui/lgpd.js';
import './painel.css';

const q = esc;
const nodes = {
  trigger: 'Mensagem recebida',
  ai: 'Responder com OpenAI',
  message: 'Enviar WhatsApp',
  condition: 'Se o texto contém',
  routes: 'Escolher entre vários caminhos',
  qualification: 'Verificar qualificação',
  roulette: 'Distribuir pela roleta',
  wait: 'Aguardar',
  handoff: 'Encaminhar para humano',
  agenda: 'Criar agendamento',
  end: 'Encerrar fluxo'
};
const qualificationFields = {
  nome: 'Nome',
  telefone: 'Telefone',
  email: 'E-mail',
  cpf: 'CPF',
  empreendimento: 'Empreendimento',
  renda: 'Renda familiar',
  cidade: 'Cidade de interesse',
  tipo_imovel: 'Tipo de imóvel',
  quartos: 'Quartos',
  orcamento: 'Orçamento',
  prazo: 'Prazo',
  observacoes: 'Observações'
};
const collections = {
  treinamentos: 'Treinamentos',
  produtos: 'Produtos',
  empreendimentos: 'Empreendimentos',
  imagens: 'Biblioteca de imagens'
};
const labels = {
  queued: 'Na fila',
  sent: 'Concluído',
  failed: 'Falhou',
  running: 'Executando',
  skipped: 'Ignorado',
  paused: 'Pausada',
  cancelled: 'Cancelada'
};

// As ações ficam registradas aqui, no nível do módulo (padrão do sistema; ver
// src/shared/ui/acoes.js e testes/t-acoes.js). Cada uma chama o painel que
// eliaMontar montou; antes de montar, não faz nada.
let painel = null;
const doPainel = nome => (el, ev) => painel && painel[nome](el, ev);
acoes({
  eliaCampo: doPainel('eliaCampo'),
  eliaMudou: doPainel('eliaMudou'),
  eliaAba: doPainel('eliaAba'),
  eliaSalvar: doPainel('eliaSalvar'),
  eliaAddItem: doPainel('eliaAddItem'),
  eliaRemoverItem: doPainel('eliaRemoverItem'),
  eliaRemoverAnexo: doPainel('eliaRemoverAnexo'),
  eliaAbrirAnexo: doPainel('eliaAbrirAnexo'),
  eliaTelaCheia: doPainel('eliaTelaCheia'),
  eliaAddCaminho: doPainel('eliaAddCaminho'),
  eliaRemoverCaminho: doPainel('eliaRemoverCaminho'),
  eliaLigarCaminho: doPainel('eliaLigarCaminho'),
  eliaLigarNo: doPainel('eliaLigarNo'),
  eliaCancelarLigacao: doPainel('eliaCancelarLigacao'),
  eliaNo: doPainel('eliaNo'),
  eliaAddNo: doPainel('eliaAddNo'),
  eliaRemoverNo: doPainel('eliaRemoverNo'),
  eliaSimular: doPainel('eliaSimular'),
  eliaBuscarContatos: doPainel('eliaBuscarContatos'),
  eliaConsentimento: doPainel('eliaConsentimento'),
  eliaEnfileirar: doPainel('eliaEnfileirar'),
  eliaStatusCampanha: doPainel('eliaStatusCampanha'),
  eliaVerDestinatarios: doPainel('eliaVerDestinatarios'),
  eliaGoogleConectar: doPainel('eliaGoogleConectar'),
  eliaGoogleDesconectar: doPainel('eliaGoogleDesconectar'),
  eliaGoogleAgendar: doPainel('eliaGoogleAgendar'),
  eliaGoogleConsultar: doPainel('eliaGoogleConsultar'),
  eliaGoogleCancelar: doPainel('eliaGoogleCancelar')
});

async function api(action, data = {}) {
  const response = await fetch(A1_URL + '/functions/v1/elia', {
    method: 'POST',
    headers: A1.headers(),
    body: JSON.stringify({ action, ...data }),
    signal: AbortSignal.timeout(45000)
  });
  const result = await response.json().catch(() => ({}));
  if (!response.ok) throw Error(result.error || 'Não foi possível acessar a ELIA.');
  return result;
}
const checked = value => (value ? ' checked' : '');
const selected = (value, current) => (value === current ? ' selected' : '');
const option = (value, label, current) =>
  `<option value="${q(value)}"${selected(value, current)}>${q(label)}</option>`;
const initial = [
  { id: 'entrada', type: 'trigger', text: '', next: 'ia', x: 20, y: 25 },
  {
    id: 'ia',
    type: 'ai',
    text: 'Responda à última mensagem e ajude o cliente com seu interesse.',
    next: 'enviar',
    x: 255,
    y: 25
  },
  { id: 'enviar', type: 'message', text: '{{resposta}}', next: 'fim', x: 490, y: 25 },
  { id: 'fim', type: 'end', text: '', x: 725, y: 25 }
];

const icons = {
  perfil: '<circle cx="12" cy="8" r="3"/><path d="M5 20v-2a5 5 0 0 1 5-5h4a5 5 0 0 1 5 5v2"/>',
  base: '<path d="M4 5h6l2 2 2-2h6v14h-6l-2 2-2-2H4zM12 7v14"/>',
  fluxo:
    '<rect x="3" y="3" width="7" height="7" rx="2"/><rect x="14" y="14" width="7" height="7" rx="2"/><path d="M6.5 10v5a2.5 2.5 0 0 0 2.5 2.5h5"/>',
  campanhas: '<path d="m4 11 15-6v14L4 13zM7 14l2 6h3"/>',
  agenda: '<rect x="3" y="5" width="18" height="16" rx="3"/><path d="M7 3v4m10-4v4M3 10h18"/>'
};

const tabs = {
  perfil: ['Perfil da agente', 'Defina como a ELIA se apresenta, conversa e encaminha atendimentos.'],
  base: ['Conhecimento', 'Cadastre orientações, produtos, empreendimentos e imagens.'],
  fluxo: ['Editor de fluxos', 'Organize os passos da conversa e simule o atendimento.'],
  campanhas: ['Campanhas', 'Crie envios e acompanhe os destinatários na fila.'],
  agenda: ['Google Agenda', 'Conecte sua agenda e gerencie compromissos.']
};

export async function eliaMontar(panel) {
  const page = panel.querySelector('[data-el-page]');
  const status = panel.querySelector('[data-el-status]');
  const nav = panel.querySelector('nav');
  const title = panel.querySelector('[data-el-title]');
  const description = panel.querySelector('[data-el-description]');
  const enabledIndicator = panel.querySelector('[data-el-enabled]');
  const google = new URLSearchParams(location.search).get('elia_google');
  let state;
  let tab = google ? 'agenda' : 'perfil';
  let selectedNode = '';
  let linking = null;
  let contacts = [];
  const recipients = new Set();
  let campaignFile = null;
  let campaignDraft = { title: '', message: '' };
  const tell = (message, error = false) => {
    status.textContent = message;
    status.classList.toggle('elia-error', error);
  };
  document.addEventListener('fullscreenchange', () => {
    const button = page.querySelector('[data-acao="eliaTelaCheia"]');
    if (button)
      button.textContent =
        document.fullscreenElement === panel.querySelector('.elia-workspace')
          ? 'Sair da tela cheia'
          : 'Tela cheia';
  });
  const reload = async () => {
    state = await api('load');
    if (!state.flow.length) state.flow = structuredClone(initial);
  };
  const save = () => api('save', { profile: state.profile, enabled: state.enabled, flow: state.flow });

  function renderProfile() {
    const p = state.profile;
    return `<div class="elia-fields">
      <label>Nome<input data-acao-input="eliaCampo" data-profile="nome" value="${q(p.nome || 'ELIA')}" maxlength="100"></label>
      <label>Função<input data-acao-input="eliaCampo" data-profile="funcao" value="${q(p.funcao || '')}" maxlength="100"></label>
      <label>Tom<select data-acao-input="eliaCampo" data-profile="tom">${['formal', 'normal', 'descontraída'].map(key => option(key, key, p.tom || 'normal')).join('')}</select></label>
      <label>Etapa ao encaminhar<select data-acao-input="eliaCampo" data-profile="pipeline"><option value="">Manter etapa</option>${state.stages.map(i => option(i.id, i.name, p.pipeline)).join('')}</select></label>
      <label>Responsável<select data-acao-input="eliaCampo" data-profile="responsavel"><option value="">Fila da Central</option>${state.partners.map(i => option(i.id, i.name, p.responsavel)).join('')}</select></label>
      <label class="elia-wide">Comportamento<textarea data-acao-input="eliaCampo" data-profile="comportamento" maxlength="20000" rows="5">${q(p.comportamento || '')}</textarea></label>
      </div><div class="elia-options">
      <label><input data-acao-input="eliaCampo" data-profile="canais" type="checkbox"${checked(p.canais?.includes('whatsapp'))}> WhatsApp</label>
      <label><input data-acao-input="eliaCampo" data-profile="agendamento" type="checkbox"${checked(p.agendamento)}> Agendamento pela ELIA</label>
      <label><input data-acao-input="eliaCampo" data-profile="followup" type="checkbox"${checked(p.followup)}> Follow-up</label>
      <label><input data-acao-input="eliaCampo" data-profile="enabled" type="checkbox"${checked(state.enabled)}> Ativar agente</label>
      </div>`;
  }

  function renderBase() {
    return Object.entries(collections)
      .map(
        ([key, title]) => `<details class="elia-records">
      <summary>${q(title)} · ${(state.profile[key] || []).length}</summary>
      ${(state.profile[key] || [])
        .map(
          (record, index) => `<article data-record="${key}" data-index="${index}">
        <label>Título<input data-acao-input="eliaCampo" data-field="titulo" maxlength="120" value="${q(record.titulo)}"></label>
        <label>${key === 'empreendimentos' ? 'Ficha técnica' : 'Descrição'}<textarea data-acao-input="eliaCampo" data-field="descricao" maxlength="4000">${q(record.descricao)}</textarea></label>
        ${(record.fotos || [])
          .map(
            (
              file,
              i
            ) => `<span class="elia-file"><button data-acao="eliaAbrirAnexo" data-file="${i}">${q(file.name)}</button>
          <button data-acao="eliaRemoverAnexo" data-file="${i}" aria-label="Remover anexo">×</button></span>`
          )
          .join('')}
        <label>${key === 'treinamentos' ? 'Material' : 'Fotos e arquivos'}<input type="file" data-acao-change="eliaMudou" data-upload="record" accept="image/png,image/jpeg,image/webp,application/pdf"></label>
        <button class="btn btn-ghost" data-acao="eliaRemoverItem">Remover item</button>
      </article>`
        )
        .join('')}
      <button class="btn btn-ghost" data-acao="eliaAddItem" data-key="${key}">Adicionar item</button></details>`
      )
      .join('');
  }

  function renderFlow() {
    const chosen = state.flow.find(item => item.id === selectedNode);
    const outputs = node => {
      if (['end', 'handoff', 'roulette'].includes(node.type)) return [];
      const list = [
        {
          key: 'next',
          label:
            node.type === 'routes'
              ? 'Nenhuma opção'
              : node.type === 'qualification'
                ? 'Completo'
                : node.type === 'condition'
                  ? 'Sim'
                  : 'Próxima etapa'
        }
      ];
      if (['condition', 'qualification'].includes(node.type))
        list.push({ key: 'other', label: node.type === 'qualification' ? 'Faltam dados' : 'Não' });
      if (node.type === 'routes')
        (node.routes || []).forEach((route, index) =>
          list.push({ key: 'route', index, label: route.text || `Opção ${index + 1}` })
        );
      return list;
    };
    const links = state.flow
      .flatMap(node =>
        outputs(node).map((port, i) => {
          const id = port.key === 'route' ? node.routes[port.index]?.next : node[port.key];
          const target = state.flow.find(item => item.id === id);
          if (!target) return '';
          const a = (node.x || 0) + 176,
            b = (node.y || 0) + 28 + i * 14;
          const c = target.x || 0,
            d = (target.y || 0) + 28;
          return `<path class="${i ? 'elia-no' : ''}" d="M${a},${b} C${a + 45},${b} ${c - 45},${d} ${c},${d}"/>`;
        })
      )
      .join('');
    const targets = value =>
      '<option value="">Selecione um nó</option>' +
      state.flow
        .filter(n => n.id !== selectedNode && n.type !== 'trigger')
        .map(n => option(n.id, n.title || nodes[n.type], value))
        .join('');
    return `<div class="elia-toolbar"><select aria-label="Tipo de nó" data-node-type>${Object.keys(nodes)
      .filter(k => k !== 'trigger')
      .map(k => option(k, nodes[k]))
      .join('')}</select>
      <button class="btn btn-ghost" data-acao="eliaAddNo">Adicionar etapa</button><button type="button" class="btn btn-ghost" data-acao="eliaTelaCheia">${document.fullscreenElement === panel.querySelector('.elia-workspace') ? 'Sair da tela cheia' : 'Tela cheia'}</button></div>
      <p>Selecione uma etapa e arraste seus pontos de saída até a etapa de destino. Use condições ou vários caminhos para criar ramificações.</p>
      <div class="elia-scroll"><div class="elia-canvas"><svg aria-hidden="true" width="1400" height="760">${links}</svg>
      ${state.flow
        .map(
          n => `<button class="elia-node${n.id === selectedNode ? ' active' : ''}" data-node="${q(n.id)}" data-acao="eliaNo"
          style="left:${Number(n.x) || 0}px;top:${Number(n.y) || 0}px"><small>${q(nodes[n.type])}</small>
          <strong>${q(n.title || nodes[n.type])}</strong></button>`
        )
        .join('')}
      ${
        chosen
          ? outputs(chosen)
              .map(
                (port, i) =>
                  `<button type="button" class="elia-port" data-port="${q(port.key)}" ${port.index === undefined ? '' : `data-index="${port.index}"`} style="left:${(Number(chosen.x) || 0) + 168}px;top:${(Number(chosen.y) || 0) + 20 + i * 14}px" aria-label="Conectar ${q(port.label)}" title="Arraste: ${q(port.label)}"></button>`
              )
              .join('')
          : ''
      }</div></div>
      ${
        chosen
          ? `<div class="elia-toolbar"><strong>Conexões:</strong>
          ${!['handoff', 'end', 'roulette'].includes(chosen.type) ? '<button type="button" class="btn btn-ghost" data-acao="eliaLigarNo" data-key="next">Ligar próxima etapa</button>' : ''}
          ${['condition', 'qualification'].includes(chosen.type) ? '<button type="button" class="btn btn-ghost" data-acao="eliaLigarNo" data-key="other">Ligar caminho alternativo</button>' : ''}
          ${linking ? '<span role="status">Selecione a etapa de destino no quadro.</span><button type="button" class="btn btn-ghost" data-acao="eliaCancelarLigacao">Cancelar</button>' : ''}</div>
          <div class="elia-fields"><label>Nome do nó<input data-acao-input="eliaCampo" data-node-field="title" value="${q(chosen.title || '')}"></label>
        ${!['handoff', 'end', 'roulette'].includes(chosen.type) ? `<label>${chosen.type === 'qualification' ? 'Quando todos estiverem preenchidos' : chosen.type === 'condition' ? 'Se sim' : 'Próxima etapa'}<select data-acao-input="eliaCampo" data-acao-change="eliaMudou" data-node-field="next">${targets(chosen.next)}</select></label>` : ''}
        ${['condition', 'qualification'].includes(chosen.type) ? `<label>${chosen.type === 'qualification' ? 'Quando faltar algum dado' : 'Se não'}<select data-acao-input="eliaCampo" data-acao-change="eliaMudou" data-node-field="other">${targets(chosen.other)}</select></label>` : ''}
        ${chosen.type === 'routes' ? `<div class="elia-wide"><p>Para cada opção, informe um trecho da mensagem e escolha a etapa de destino. A primeira opção encontrada será usada; se nenhuma combinar, segue a próxima etapa.</p>${(chosen.routes || []).map((route, i) => `<div class="elia-toolbar"><label>Se a mensagem contém<input data-acao-input="eliaCampo" data-route-text="${i}" maxlength="200" value="${q(route.text)}"></label><label>Seguir para<select data-acao-input="eliaCampo" data-acao-change="eliaMudou" data-route-next="${i}">${targets(route.next)}</select></label><button type="button" class="btn btn-ghost" data-acao="eliaLigarCaminho" data-key="${i}">Ligar no quadro</button><button type="button" class="btn btn-ghost" data-acao="eliaRemoverCaminho" data-key="${i}">Remover opção</button></div>`).join('')}<button type="button" class="btn btn-ghost" data-acao="eliaAddCaminho">Adicionar caminho</button></div>` : ''}
        ${
          ['qualification', 'roulette'].includes(chosen.type)
            ? `<fieldset class="elia-wide"><legend>Dados obrigatórios para avançar</legend><div class="elia-options">${Object.entries(
                qualificationFields
              )
                .map(
                  ([key, label]) =>
                    `<label><input type="checkbox" data-acao-input="eliaCampo" data-qualification-field="${q(key)}"${checked(chosen.fields?.includes(key))}> ${q(label)}</label>`
                )
                .join('')}</div></fieldset>`
            : ''
        }
        ${chosen.type === 'wait' ? `<label>Minutos<input type="number" min="1" max="43200" data-acao-input="eliaCampo" data-node-field="minutes" value="${Number(chosen.minutes) || 60}"></label>` : ''}
        ${
          ['ai', 'message', 'condition', 'handoff', 'agenda'].includes(chosen.type)
            ? `<label class="elia-wide">${chosen.type === 'agenda' ? 'Evento (JSON com title, start e end em ISO)' : 'Texto ou instrução'}
          <textarea data-acao-input="eliaCampo" data-node-field="text" rows="3">${q(chosen.text)}</textarea></label>`
            : ''
        }</div>
        ${chosen.type !== 'trigger' ? '<button class="btn btn-ghost" data-acao="eliaRemoverNo">Excluir nó</button>' : ''}`
          : ''
      }
      <details><summary>Dados de qualificação para a simulação</summary><p>Preencha valores fictícios para testar os caminhos do fluxo. Eles não são salvos em leads.</p><div class="elia-fields">${Object.entries(
        qualificationFields
      )
        .map(
          ([key, label]) => `<label>${q(label)}<input data-simulation-field="${key}" maxlength="500"></label>`
        )
        .join('')}</div></details>
      <div class="elia-toolbar"><input data-simulation placeholder="Mensagem do lead para simular" aria-label="Mensagem de teste"><button class="btn btn-ghost" data-acao="eliaSimular">Simular</button></div>
      <pre data-trace hidden></pre>
      ${state.jobs.length ? '<details><summary>Execuções recentes</summary><ul>' + state.jobs.map(i => `<li>${q(labels[i.status])} · ${q(i.detail || new Date(i.run_at).toLocaleString('pt-BR'))}</li>`).join('') + '</ul></details>' : ''}`;
  }

  function renderCampaigns() {
    return `<div class="elia-fields"><label>Título<input data-acao-input="eliaCampo" data-draft="title" maxlength="120" value="${q(campaignDraft.title)}"></label>
      <label>Anexo opcional<input type="file" data-acao-change="eliaMudou" data-upload="campaign" accept="image/png,image/jpeg,image/webp,application/pdf">
      ${q(campaignFile?.name || '')}</label>
      <label class="elia-wide">Mensagem<textarea data-acao-input="eliaCampo" data-draft="message" maxlength="4000" placeholder="Olá, {{nome}}!">${q(campaignDraft.message)}</textarea></label></div>
      <div class="elia-toolbar"><input data-search placeholder="Buscar leads por nome" aria-label="Buscar leads"><button class="btn btn-ghost" data-acao="eliaBuscarContatos">Buscar</button>
      <span data-recipient-count></span></div><div data-contacts></div>
      <button class="btn btn-primary" data-acao="eliaEnfileirar">Enfileirar campanha</button>
      <h3>Campanhas</h3>${state.campaigns
        .map(
          item => `<article class="elia-campaign" data-campaign="${q(item.id)}">
      <strong>${q(item.title)}</strong> <span>${q(labels[item.status])}</span>
      <button class="btn btn-ghost" data-acao="eliaVerDestinatarios">Ver destinatários</button>
      ${
        item.status !== 'cancelled'
          ? `<button class="btn btn-ghost" data-acao="eliaStatusCampanha" data-status="${item.status === 'paused' ? 'queued' : 'paused'}">${item.status === 'paused' ? 'Retomar' : 'Pausar'}</button>
      <button class="btn btn-ghost" data-acao="eliaStatusCampanha" data-status="cancelled">Cancelar fila</button>`
          : ''
      }<div data-results></div></article>`
        )
        .join('')}`;
  }

  function renderAgenda() {
    return `<div class="elia-toolbar"><strong>${state.google ? 'Conta Google conectada' : 'Conta Google desconectada'}</strong>
      ${
        state.google
          ? '<button class="btn btn-ghost" data-acao="eliaGoogleDesconectar">Desconectar</button>'
          : `<button class="btn btn-primary" data-acao="eliaGoogleConectar"${state.googleReady ? '' : ' disabled'}>Conectar Google Agenda</button>`
      }</div>
      ${!state.googleReady ? '<p>A integração Google precisa ser habilitada pela plataforma.</p>' : ''}
      <div class="elia-fields"><label>ID da agenda<input data-acao-input="eliaCampo" data-profile="calendario" value="${q(state.profile.calendario || 'primary')}"></label>
      <label>Lembrete WhatsApp para agendamentos da ELIA<select data-acao-input="eliaCampo" data-profile="lembrete">${[
        [0, 'Desativado'],
        [15, '15 minutos antes'],
        [30, '30 minutos antes'],
        [60, '1 hora antes'],
        [1440, '1 dia antes']
      ]
        .map(([v, t]) => option(String(v), t, String(state.profile.lembrete || 0)))
        .join('')}</select></label></div>
      ${
        state.google
          ? `<div class="elia-fields"><label>Título do compromisso<input data-event="title"></label>
      <label>Mês de consulta<input type="month" data-month></label>
      <label>Início<input type="datetime-local" data-event="start"></label><label>Fim<input type="datetime-local" data-event="end"></label>
      </div><div class="elia-toolbar"><button class="btn btn-primary" data-acao="eliaGoogleAgendar">Agendar com Meet</button>
      <button class="btn btn-ghost" data-acao="eliaGoogleConsultar">Consultar agenda</button></div><div data-events></div>`
          : ''
      }`;
  }

  function showContacts() {
    const list = page.querySelector('[data-contacts]');
    if (!list) return;
    page.querySelector('[data-recipient-count]').textContent = recipients.size + ' selecionados';
    list.innerHTML = contacts
      .map(
        item => `<div class="elia-contact"><label><input data-acao-input="eliaCampo" data-recipient="${q(item.id)}" type="checkbox"
      ${checked(recipients.has(item.id))}${item.consent ? '' : ' disabled'}> ${q(item.client_name || 'Sem nome')} · ${q(item.client_phone)}</label>
      <button class="btn btn-ghost" data-acao="eliaConsentimento" data-id="${q(item.id)}" data-granted="${item.consent}">${item.consent ? 'Revogar consentimento' : 'Registrar consentimento'}</button></div>`
      )
      .join('');
  }

  function render() {
    title.textContent = tabs[tab][0];
    description.textContent = tabs[tab][1];
    nav.innerHTML = Object.entries(tabs)
      .map(
        ([key, [label]]) =>
          `<button type="button" data-acao="eliaAba" data-key="${q(key)}" aria-current="${key === tab ? 'true' : 'false'}"><svg viewBox="0 0 24 24" aria-hidden="true">${icons[key]}</svg><span>${q(label)}</span></button>`
      )
      .join('');
    const views = {
      perfil: renderProfile,
      base: renderBase,
      fluxo: renderFlow,
      campanhas: renderCampaigns,
      agenda: renderAgenda
    };
    const canvas = tab === 'fluxo' ? page.querySelector('.elia-scroll') : null;
    const viewport = canvas && { left: canvas.scrollLeft, top: canvas.scrollTop };
    page.innerHTML =
      views[tab]() +
      (tab === 'campanhas'
        ? ''
        : '<footer><button class="btn btn-primary" data-acao="eliaSalvar">Salvar configuração</button></footer>');
    if (tab === 'campanhas') showContacts();
    if (viewport) page.querySelector('.elia-scroll').scrollTo(viewport);
  }

  async function upload(input) {
    const file = input.files[0];
    if (!file) return;
    if (file.size > 5242880) throw Error('O arquivo deve ter até 5 MB.');
    const encoded = await new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(String(reader.result).split(',')[1]);
      reader.onerror = reject;
      reader.readAsDataURL(file);
    });
    return api('upload', { data: encoded, mime: file.type, name: file.name });
  }
  const recordFor = element => {
    const row = element.closest('[data-record]');
    return row ? state.profile[row.dataset.record][Number(row.dataset.index)] : null;
  };

  // Campos: cada um declara data-acao-input="eliaCampo"; os que mudam o
  // desenho (destino de uma conexão) ou mandam arquivo, data-acao-change.
  function campo(field) {
    if (field.dataset.routeText !== undefined)
      state.flow.find(item => item.id === selectedNode).routes[Number(field.dataset.routeText)].text =
        field.value;
    if (field.dataset.routeNext !== undefined)
      state.flow.find(item => item.id === selectedNode).routes[Number(field.dataset.routeNext)].next =
        field.value;
    if (field.dataset.qualificationField) {
      const node = state.flow.find(item => item.id === selectedNode);
      const fields = new Set(node.fields || []);
      if (field.checked) fields.add(field.dataset.qualificationField);
      else fields.delete(field.dataset.qualificationField);
      node.fields = [...fields];
    }
    const p = field.dataset.profile;
    const n = field.dataset.nodeField;
    if (p === 'enabled') state.enabled = field.checked;
    else if (p === 'canais') state.profile.canais = field.checked ? ['whatsapp'] : [];
    else if (p) state.profile[p] = field.type === 'checkbox' ? field.checked : field.value;
    if (n)
      state.flow.find(item => item.id === selectedNode)[n] =
        n === 'minutes' ? Number(field.value) : field.value;
    if (field.dataset.field) recordFor(field)[field.dataset.field] = field.value;
    if (field.dataset.draft) campaignDraft[field.dataset.draft] = field.value;
    if (field.dataset.recipient) {
      if (field.checked) recipients.add(field.dataset.recipient);
      else recipients.delete(field.dataset.recipient);
      showContacts();
    }
  }
  async function mudou(field) {
    if (['next', 'other'].includes(field.dataset.nodeField) || field.dataset.routeNext !== undefined)
      render();
    if (!field.dataset.upload) return;
    try {
      const record = recordFor(field);
      const file = await upload(field);
      if (!file) return;
      if (record) (record.fotos ||= []).push(file);
      else campaignFile = file;
      const open = [...page.querySelectorAll('details')].map(item => item.open);
      render();
      page.querySelectorAll('details').forEach((item, i) => {
        item.open = Boolean(open[i]);
      });
      tell('Anexo carregado.');
    } catch (error) {
      tell(error.message, true);
    }
  }
  // O arraste dos nós e das conexões fica com ouvintes do próprio quadro:
  // acoes() não atende eventos de ponteiro (pointerdown/move/up), que são de
  // widget e disparam dezenas de vezes por segundo.
  let drag;
  let portDrag;
  page.addEventListener('pointerdown', event => {
    const port = event.target.closest('[data-port]');
    if (port && event.button === 0) {
      const canvas = port.closest('.elia-canvas');
      const bounds = canvas.getBoundingClientRect();
      const preview = document.createElementNS('http://www.w3.org/2000/svg', 'path');
      preview.setAttribute('class', 'elia-link-preview');
      canvas.querySelector('svg').appendChild(preview);
      portDrag = {
        port,
        preview,
        canvas,
        source: selectedNode,
        key: port.dataset.port,
        index: Number(port.dataset.index),
        x: event.clientX - bounds.left,
        y: event.clientY - bounds.top
      };
      port.setPointerCapture(event.pointerId);
      event.preventDefault();
      return;
    }
    const button = event.target.closest('[data-node]');
    if (!button || event.button !== 0 || linking) return;
    const node = state.flow.find(item => item.id === button.dataset.node);
    drag = { button, node, x: event.clientX - node.x, y: event.clientY - node.y, start: event.clientX };
    button.setPointerCapture(event.pointerId);
  });
  page.addEventListener('pointermove', event => {
    if (portDrag) {
      const bounds = portDrag.canvas.getBoundingClientRect();
      const x = event.clientX - bounds.left,
        y = event.clientY - bounds.top;
      portDrag.preview.setAttribute(
        'd',
        `M${portDrag.x},${portDrag.y} C${portDrag.x + 45},${portDrag.y} ${x - 45},${y} ${x},${y}`
      );
      return;
    }
    if (!drag) return;
    drag.node.x = Math.max(0, Math.min(1220, event.clientX - drag.x));
    drag.node.y = Math.max(0, Math.min(690, event.clientY - drag.y));
    drag.button.style.left = drag.node.x + 'px';
    drag.button.style.top = drag.node.y + 'px';
  });
  page.addEventListener('pointercancel', () => {
    drag = null;
    portDrag?.preview.remove();
    portDrag = null;
  });
  page.addEventListener('pointerup', event => {
    if (portDrag) {
      const targetButton = document.elementFromPoint(event.clientX, event.clientY)?.closest('[data-node]');
      const target = state.flow.find(item => item.id === targetButton?.dataset.node);
      const source = state.flow.find(item => item.id === portDrag.source);
      const reachable = (id, seen = new Set()) => {
        if (id === source.id) return true;
        if (!id || seen.has(id)) return false;
        seen.add(id);
        const node = state.flow.find(item => item.id === id);
        return node
          ? [node.next, node.other, ...(node.routes || []).map(route => route.next)].some(next =>
              reachable(next, seen)
            )
          : false;
      };
      if (!target || target.type === 'trigger') tell('Arraste o ponto até outra etapa.', true);
      else if (reachable(target.id)) tell('Essa conexão criaria um ciclo. Escolha outra etapa.', true);
      else {
        if (portDrag.key === 'route') source.routes[portDrag.index].next = target.id;
        else source[portDrag.key] = target.id;
        tell('Conexão criada. Salve a configuração para ativá-la.');
      }
      portDrag.preview.remove();
      portDrag = null;
      render();
      return;
    }
    if (!drag) return;
    selectedNode = drag.node.id;
    drag = null;
    render();
  });

  function showAgentStatus() {
    enabledIndicator.textContent = state.enabled ? 'Agente ativo' : 'Agente desativado';
    enabledIndicator.dataset.active = String(state.enabled);
    enabledIndicator.hidden = false;
  }

  // Botões: cada um declara data-acao="elia..." (ver src/shared/ui/acoes.js).
  // O botão fica desligado enquanto a ação roda; erro aparece no status.
  const rodar = fn => async el => {
    const button = /** @type {HTMLButtonElement} */ (el);
    if (button.disabled) return;
    button.disabled = true;
    try {
      await fn(button, button.dataset);
    } catch (error) {
      tell(error.message, true);
    } finally {
      button.disabled = false;
    }
  };
  const abrirColecao = key => {
    const lista = page.querySelectorAll('.elia-records')[Object.keys(collections).indexOf(key)];
    if (lista) lista.open = true;
  };
  const destinoDaLigacao = button => {
    if (button.dataset.node === linking.source) throw Error('Escolha outra etapa como destino.');
    const source = state.flow.find(item => item.id === linking.source);
    const target = state.flow.find(item => item.id === button.dataset.node);
    if (target?.type === 'trigger') throw Error('O gatilho não pode receber conexões.');
    if (linking.key === 'route') source.routes[linking.index].next = target.id;
    else source[linking.key] = target.id;
    selectedNode = source.id;
    linking = null;
  };
  const consultarAgenda = async () => {
    const month = page.querySelector('[data-month]').value;
    const start = month
      ? new Date(month + '-01T00:00:00')
      : new Date(new Date().getFullYear(), new Date().getMonth(), 1);
    const end = new Date(start.getFullYear(), start.getMonth() + 1, 1);
    const items = await api('googleEvents', { start: start.toISOString(), end: end.toISOString() });
    page.querySelector('[data-events]').innerHTML = items.length
      ? '<ul>' +
        items
          .map(item => {
            const date = item.start?.dateTime
              ? new Date(item.start.dateTime).toLocaleString('pt-BR')
              : item.start?.date;
            const link = /^https:\/\/(calendar\.google\.com|www\.google\.com|meet\.google\.com)\//.test(
              item.htmlLink || ''
            )
              ? item.htmlLink
              : '';
            return `<li>${q(date || '')} · ${q(item.summary || 'Ocupado')} ${link ? `<a href="${q(link)}" target="_blank" rel="noopener noreferrer">Abrir</a>` : ''}
            ${item.extendedProperties?.private?.siimob === 'elia' ? `<button class="btn btn-ghost" data-acao="eliaGoogleCancelar" data-id="${q(item.id)}">Cancelar</button>` : ''}</li>`;
          })
          .join('') +
        '</ul>'
      : '<p>Sem compromissos no período.</p>';
  };
  const buscarContatos = async () => {
    contacts = (await api('contacts', { search: page.querySelector('[data-search]').value })).contacts;
    showContacts();
  };
  const linkExterno = (href, texto) => {
    const link = document.createElement('a');
    link.href = href;
    link.textContent = texto;
    link.target = '_blank';
    link.rel = 'noopener noreferrer';
    return link;
  };

  painel = {
    eliaCampo: el => campo(el),
    eliaMudou: el => mudou(el),
    eliaAba: rodar(async (button, { key }) => {
      tab = key;
      render();
      nav.querySelector('[aria-current="true"]').focus();
      tell('');
    }),
    eliaSalvar: rodar(async () => {
      await save();
      showAgentStatus();
      tell('Configuração salva.');
    }),
    eliaAddItem: rodar(async (button, { key }) => {
      (state.profile[key] ||= []).push({ titulo: '', descricao: '', fotos: [] });
      render();
      abrirColecao(key);
    }),
    eliaRemoverItem: rodar(async button => {
      const row = button.closest('[data-record]');
      state.profile[row.dataset.record].splice(Number(row.dataset.index), 1);
      render();
      abrirColecao(row.dataset.record);
    }),
    eliaRemoverAnexo: rodar(async button => {
      const row = button.closest('[data-record]');
      recordFor(button).fotos.splice(Number(button.dataset.file), 1);
      render();
      abrirColecao(row.dataset.record);
    }),
    eliaAbrirAnexo: rodar(async button => {
      const { url } = await api('asset', { file: recordFor(button).fotos[Number(button.dataset.file)] });
      status.replaceChildren(linkExterno(url, 'Abrir anexo'));
    }),
    eliaTelaCheia: rodar(async () => {
      const workspace = panel.querySelector('.elia-workspace');
      if (document.fullscreenElement === workspace) await document.exitFullscreen();
      else await workspace.requestFullscreen();
      render();
    }),
    eliaAddCaminho: rodar(async () => {
      const node = state.flow.find(item => item.id === selectedNode);
      if ((node.routes || []).length >= 20) throw Error('Esta etapa pode ter até 20 caminhos.');
      (node.routes ||= []).push({ text: '', next: '' });
      render();
    }),
    eliaRemoverCaminho: rodar(async (button, { key }) => {
      state.flow.find(item => item.id === selectedNode).routes.splice(Number(key), 1);
      render();
    }),
    eliaLigarCaminho: rodar(async (button, { key }) => {
      linking = { source: selectedNode, key: 'route', index: Number(key) };
      render();
    }),
    eliaLigarNo: rodar(async (button, { key }) => {
      linking = { source: selectedNode, key };
      render();
    }),
    eliaCancelarLigacao: rodar(async () => {
      linking = null;
      render();
    }),
    eliaNo: rodar(async button => {
      if (linking) destinoDaLigacao(button);
      else selectedNode = button.dataset.node;
      render();
    }),
    eliaAddNo: rodar(async () => {
      if (state.flow.length >= 30) throw Error('O fluxo pode ter até 30 nós.');
      selectedNode = crypto.randomUUID();
      const i = state.flow.length;
      state.flow.push({
        id: selectedNode,
        type: page.querySelector('[data-node-type]').value,
        x: 20 + (i % 5) * 235,
        y: 25 + Math.floor(i / 5) * 100,
        minutes: 60,
        text: ''
      });
      render();
    }),
    eliaRemoverNo: rodar(async () => {
      state.flow = state.flow.filter(node => node.id !== selectedNode);
      for (const node of state.flow) {
        if (node.next === selectedNode) delete node.next;
        if (node.other === selectedNode) delete node.other;
        for (const route of node.routes || []) if (route.next === selectedNode) route.next = '';
      }
      selectedNode = '';
      render();
    }),
    eliaSimular: rodar(async () => {
      const result = await api('simulate', {
        profile: state.profile,
        flow: state.flow,
        message: page.querySelector('[data-simulation]').value,
        qualification: Object.fromEntries(
          [...page.querySelectorAll('[data-simulation-field]')].map(field => [
            field.dataset.simulationField,
            field.value
          ])
        )
      });
      const trace = page.querySelector('[data-trace]');
      trace.hidden = false;
      trace.textContent = [...result.trace, result.output].filter(Boolean).join('\n') || 'Fluxo encerrado.';
      tell('Simulação concluída. Nenhuma mensagem foi enviada.');
    }),
    eliaBuscarContatos: rodar(buscarContatos),
    eliaConsentimento: rodar(async (button, { id, granted }) => {
      const evidence =
        granted === 'true'
          ? ''
          : window.prompt('Onde e quando este contato autorizou mensagens de campanha?');
      if (granted !== 'true' && !evidence?.trim()) return;
      await api('consent', { id, granted: granted !== 'true', evidence });
      if (granted === 'true') recipients.delete(id);
      await buscarContatos();
    }),
    eliaEnfileirar: rodar(async () => {
      if (!recipients.size) throw Error('Selecione os contatos com consentimento.');
      if (!window.confirm('Enfileirar o envio de WhatsApp para ' + recipients.size + ' contatos?')) return;
      await api('campaign', { ...campaignDraft, file: campaignFile, ids: [...recipients] });
      recipients.clear();
      campaignFile = null;
      campaignDraft = { title: '', message: '' };
      state.campaigns = (await api('load')).campaigns;
      render();
      tell('Campanha enfileirada.');
    }),
    eliaStatusCampanha: rodar(async button => {
      const card = button.closest('[data-campaign]');
      await api('campaignStatus', { id: card.dataset.campaign, status: button.dataset.status });
      state.campaigns = (await api('load')).campaigns;
      render();
    }),
    eliaVerDestinatarios: rodar(async button => {
      const card = button.closest('[data-campaign]');
      const result = await api('campaignJobs', { id: card.dataset.campaign });
      card.querySelector('[data-results]').innerHTML =
        '<ul>' +
        result
          .map(
            item =>
              `<li>${q(item.a1_cases?.client_name || 'Contato')} · ${q(labels[item.status])} ${q(item.detail || '')}</li>`
          )
          .join('') +
        '</ul>';
    }),
    eliaGoogleConectar: rodar(async () => {
      location.assign((await api('googleConnect')).url);
    }),
    eliaGoogleDesconectar: rodar(async () => {
      await api('googleDisconnect');
      state.google = false;
      render();
    }),
    eliaGoogleAgendar: rodar(async () => {
      const value = key => page.querySelector(`[data-event="${key}"]`).value;
      if (!value('start') || !value('end')) throw Error('Informe início e fim.');
      const result = await api('googleBook', {
        title: value('title'),
        start: new Date(value('start')).toISOString(),
        end: new Date(value('end')).toISOString()
      });
      tell('Compromisso criado.');
      if (result.hangoutLink) status.append(linkExterno(result.hangoutLink, ' Abrir Google Meet'));
    }),
    eliaGoogleConsultar: rodar(consultarAgenda),
    eliaGoogleCancelar: rodar(async (button, { id }) => {
      if (!window.confirm('Cancelar este compromisso no Google Agenda?')) return;
      await api('googleCancel', { id });
      await consultarAgenda();
    })
  };

  await reload();
  showAgentStatus();
  render();
  tell(
    google === 'conectado'
      ? 'Google Agenda conectado.'
      : google === 'erro'
        ? 'A conexão com o Google não foi concluída.'
        : '',
    google === 'erro'
  );
}
