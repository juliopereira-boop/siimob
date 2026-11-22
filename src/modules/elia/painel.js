import { A1, A1_URL } from '../../shared/api/config.js';
import { esc } from '../../shared/utils/texto.js';
import './painel.css';

const q = esc;
const nodes = {
  trigger: 'Mensagem recebida',
  ai: 'Responder com OpenAI',
  message: 'Enviar WhatsApp',
  condition: 'Se o texto contém',
  wait: 'Aguardar',
  handoff: 'Encaminhar para humano',
  agenda: 'Criar agendamento',
  end: 'Encerrar fluxo'
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
  let contacts = [];
  const recipients = new Set();
  let campaignFile = null;
  let campaignDraft = { title: '', message: '' };
  const tell = (message, error = false) => {
    status.textContent = message;
    status.classList.toggle('elia-error', error);
  };
  const reload = async () => {
    state = await api('load');
    if (!state.flow.length) state.flow = structuredClone(initial);
  };
  const save = () => api('save', { profile: state.profile, enabled: state.enabled, flow: state.flow });

  function renderProfile() {
    const p = state.profile;
    return `<div class="elia-fields">
      <label>Nome<input data-profile="nome" value="${q(p.nome || 'ELIA')}" maxlength="100"></label>
      <label>Função<input data-profile="funcao" value="${q(p.funcao || '')}" maxlength="100"></label>
      <label>Tom<select data-profile="tom">${['formal', 'normal', 'descontraída'].map(key => option(key, key, p.tom || 'normal')).join('')}</select></label>
      <label>Etapa ao encaminhar<select data-profile="pipeline"><option value="">Manter etapa</option>${state.stages.map(i => option(i.id, i.name, p.pipeline)).join('')}</select></label>
      <label>Responsável<select data-profile="responsavel"><option value="">Fila da Central</option>${state.partners.map(i => option(i.id, i.name, p.responsavel)).join('')}</select></label>
      <label class="elia-wide">Comportamento<textarea data-profile="comportamento" maxlength="20000" rows="5">${q(p.comportamento || '')}</textarea></label>
      </div><div class="elia-options">
      <label><input data-profile="canais" type="checkbox"${checked(p.canais?.includes('whatsapp'))}> WhatsApp</label>
      <label><input data-profile="agendamento" type="checkbox"${checked(p.agendamento)}> Agendamento pela ELIA</label>
      <label><input data-profile="followup" type="checkbox"${checked(p.followup)}> Follow-up</label>
      <label><input data-profile="enabled" type="checkbox"${checked(state.enabled)}> Ativar agente</label>
      </div>`;
  }

  function renderBase() {
    return Object.entries(collections)
      .map(
        ([key, title]) => `<details class="elia-records">
      <summary>${title} · ${(state.profile[key] || []).length}</summary>
      ${(state.profile[key] || [])
        .map(
          (record, index) => `<article data-record="${key}" data-index="${index}">
        <label>Título<input data-field="titulo" maxlength="120" value="${q(record.titulo)}"></label>
        <label>${key === 'empreendimentos' ? 'Ficha técnica' : 'Descrição'}<textarea data-field="descricao" maxlength="4000">${q(record.descricao)}</textarea></label>
        ${(record.fotos || [])
          .map(
            (
              file,
              i
            ) => `<span class="elia-file"><button data-el="asset" data-file="${i}">${q(file.name)}</button>
          <button data-el="remove-file" data-file="${i}" aria-label="Remover anexo">×</button></span>`
          )
          .join('')}
        <label>${key === 'treinamentos' ? 'Material' : 'Fotos e arquivos'}<input type="file" data-upload="record" accept="image/png,image/jpeg,image/webp,application/pdf"></label>
        <button class="btn btn-ghost" data-el="remove-record">Remover item</button>
      </article>`
        )
        .join('')}
      <button class="btn btn-ghost" data-el="add-record" data-key="${key}">Adicionar item</button></details>`
      )
      .join('');
  }

  function renderFlow() {
    const chosen = state.flow.find(item => item.id === selectedNode);
    const links = state.flow
      .flatMap(node =>
        [node.next, node.other].map((id, i) => {
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
      <button class="btn btn-ghost" data-el="add-node">Adicionar nó</button></div>
      <div class="elia-scroll"><div class="elia-canvas"><svg aria-hidden="true" width="1400" height="760">${links}</svg>
      ${state.flow
        .map(
          n => `<button class="elia-node${n.id === selectedNode ? ' active' : ''}" data-node="${q(n.id)}" data-el="node"
          style="left:${Number(n.x) || 0}px;top:${Number(n.y) || 0}px"><small>${q(nodes[n.type])}</small>
          <strong>${q(n.title || nodes[n.type])}</strong></button>`
        )
        .join('')}</div></div>
      ${
        chosen
          ? `<div class="elia-fields"><label>Nome do nó<input data-node-field="title" value="${q(chosen.title || '')}"></label>
        ${!['handoff', 'end'].includes(chosen.type) ? `<label>${chosen.type === 'condition' ? 'Se sim' : 'Próximo nó'}<select data-node-field="next">${targets(chosen.next)}</select></label>` : ''}
        ${chosen.type === 'condition' ? `<label>Se não<select data-node-field="other">${targets(chosen.other)}</select></label>` : ''}
        ${chosen.type === 'wait' ? `<label>Minutos<input type="number" min="1" max="43200" data-node-field="minutes" value="${Number(chosen.minutes) || 60}"></label>` : ''}
        ${
          ['ai', 'message', 'condition', 'handoff', 'agenda'].includes(chosen.type)
            ? `<label class="elia-wide">${chosen.type === 'agenda' ? 'Evento (JSON com title, start e end em ISO)' : 'Texto ou instrução'}
          <textarea data-node-field="text" rows="3">${q(chosen.text)}</textarea></label>`
            : ''
        }</div>
        ${chosen.type !== 'trigger' ? '<button class="btn btn-ghost" data-el="remove-node">Excluir nó</button>' : ''}`
          : ''
      }
      <div class="elia-toolbar"><input data-simulation placeholder="Mensagem do lead para simular" aria-label="Mensagem de teste"><button class="btn btn-ghost" data-el="simulate">Simular</button></div>
      <pre data-trace hidden></pre>
      ${state.jobs.length ? '<details><summary>Execuções recentes</summary><ul>' + state.jobs.map(i => `<li>${q(labels[i.status])} · ${q(i.detail || new Date(i.run_at).toLocaleString('pt-BR'))}</li>`).join('') + '</ul></details>' : ''}`;
  }

  function renderCampaigns() {
    return `<div class="elia-fields"><label>Título<input data-draft="title" maxlength="120" value="${q(campaignDraft.title)}"></label>
      <label>Anexo opcional<input type="file" data-upload="campaign" accept="image/png,image/jpeg,image/webp,application/pdf">
      ${q(campaignFile?.name || '')}</label>
      <label class="elia-wide">Mensagem<textarea data-draft="message" maxlength="4000" placeholder="Olá, {{nome}}!">${q(campaignDraft.message)}</textarea></label></div>
      <div class="elia-toolbar"><input data-search placeholder="Buscar leads por nome" aria-label="Buscar leads"><button class="btn btn-ghost" data-el="contacts">Buscar</button>
      <span data-recipient-count></span></div><div data-contacts></div>
      <button class="btn btn-primary" data-el="campaign">Enfileirar campanha</button>
      <h3>Campanhas</h3>${state.campaigns
        .map(
          item => `<article class="elia-campaign" data-campaign="${q(item.id)}">
      <strong>${q(item.title)}</strong> <span>${q(labels[item.status])}</span>
      <button class="btn btn-ghost" data-el="campaign-jobs">Ver destinatários</button>
      ${
        item.status !== 'cancelled'
          ? `<button class="btn btn-ghost" data-el="campaign-status" data-status="${item.status === 'paused' ? 'queued' : 'paused'}">${item.status === 'paused' ? 'Retomar' : 'Pausar'}</button>
      <button class="btn btn-ghost" data-el="campaign-status" data-status="cancelled">Cancelar fila</button>`
          : ''
      }<div data-results></div></article>`
        )
        .join('')}`;
  }

  function renderAgenda() {
    return `<div class="elia-toolbar"><strong>${state.google ? 'Conta Google conectada' : 'Conta Google desconectada'}</strong>
      ${
        state.google
          ? '<button class="btn btn-ghost" data-el="googleDisconnect">Desconectar</button>'
          : `<button class="btn btn-primary" data-el="googleConnect"${state.googleReady ? '' : ' disabled'}>Conectar Google Agenda</button>`
      }</div>
      ${!state.googleReady ? '<p>A integração Google precisa ser habilitada pela plataforma.</p>' : ''}
      <div class="elia-fields"><label>ID da agenda<input data-profile="calendario" value="${q(state.profile.calendario || 'primary')}"></label>
      <label>Lembrete WhatsApp para agendamentos da ELIA<select data-profile="lembrete">${[
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
      </div><div class="elia-toolbar"><button class="btn btn-primary" data-el="googleBook">Agendar com Meet</button>
      <button class="btn btn-ghost" data-el="googleEvents">Consultar agenda</button></div><div data-events></div>`
          : ''
      }`;
  }

  function showContacts() {
    const list = page.querySelector('[data-contacts]');
    if (!list) return;
    page.querySelector('[data-recipient-count]').textContent = recipients.size + ' selecionados';
    list.innerHTML = contacts
      .map(
        item => `<div class="elia-contact"><label><input data-recipient="${q(item.id)}" type="checkbox"
      ${checked(recipients.has(item.id))}${item.consent ? '' : ' disabled'}> ${q(item.client_name || 'Sem nome')} · ${q(item.client_phone)}</label>
      <button class="btn btn-ghost" data-el="consent" data-id="${q(item.id)}" data-granted="${item.consent}">${item.consent ? 'Revogar consentimento' : 'Registrar consentimento'}</button></div>`
      )
      .join('');
  }

  function render() {
    title.textContent = tabs[tab][0];
    description.textContent = tabs[tab][1];
    nav.innerHTML = Object.entries(tabs)
      .map(
        ([key, [label]]) =>
          `<button type="button" data-el="tab" data-key="${key}" aria-current="${key === tab ? 'true' : 'false'}"><svg viewBox="0 0 24 24" aria-hidden="true">${icons[key]}</svg><span>${label}</span></button>`
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
        : '<footer><button class="btn btn-primary" data-el="save">Salvar configuração</button></footer>');
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

  page.addEventListener('input', event => {
    const field = event.target;
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
  });
  page.addEventListener('change', async event => {
    const field = event.target;
    if (['next', 'other'].includes(field.dataset.nodeField)) render();
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
  });
  let drag;
  page.addEventListener('pointerdown', event => {
    const button = event.target.closest('[data-node]');
    if (!button || event.button !== 0) return;
    const node = state.flow.find(item => item.id === button.dataset.node);
    drag = { button, node, x: event.clientX - node.x, y: event.clientY - node.y, start: event.clientX };
    button.setPointerCapture(event.pointerId);
  });
  page.addEventListener('pointermove', event => {
    if (!drag) return;
    drag.node.x = Math.max(0, Math.min(1220, event.clientX - drag.x));
    drag.node.y = Math.max(0, Math.min(690, event.clientY - drag.y));
    drag.button.style.left = drag.node.x + 'px';
    drag.button.style.top = drag.node.y + 'px';
  });
  page.addEventListener('pointercancel', () => {
    drag = null;
  });
  page.addEventListener('pointerup', () => {
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

  panel.addEventListener('click', async event => {
    const button = event.target.closest('[data-el]');
    if (!button || button.disabled) return;
    const { el, key, id, granted } = button.dataset;
    button.disabled = true;
    try {
      if (el === 'tab') {
        tab = key;
        render();
        nav.querySelector('[aria-current="true"]').focus();
        tell('');
      } else if (el === 'save') {
        await save();
        showAgentStatus();
        tell('Configuração salva.');
      } else if (el === 'add-record') {
        (state.profile[key] ||= []).push({ titulo: '', descricao: '', fotos: [] });
        render();
        page.querySelectorAll('.elia-records')[Object.keys(collections).indexOf(key)].open = true;
      } else if (el === 'remove-record' || el === 'remove-file') {
        const row = button.closest('[data-record]');
        const record = recordFor(button);
        if (el === 'remove-record') state.profile[row.dataset.record].splice(Number(row.dataset.index), 1);
        else record.fotos.splice(Number(button.dataset.file), 1);
        render();
        page.querySelectorAll('.elia-records')[Object.keys(collections).indexOf(row.dataset.record)].open =
          true;
      } else if (el === 'asset') {
        const { url } = await api('asset', { file: recordFor(button).fotos[Number(button.dataset.file)] });
        const link = document.createElement('a');
        link.href = url;
        link.textContent = 'Abrir anexo';
        link.target = '_blank';
        link.rel = 'noopener noreferrer';
        status.replaceChildren(link);
      } else if (el === 'node') {
        selectedNode = button.dataset.node;
        render();
      } else if (el === 'add-node') {
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
      } else if (el === 'remove-node') {
        state.flow = state.flow.filter(node => node.id !== selectedNode);
        for (const node of state.flow) {
          if (node.next === selectedNode) delete node.next;
          if (node.other === selectedNode) delete node.other;
        }
        selectedNode = '';
        render();
      } else if (el === 'simulate') {
        const result = await api('simulate', {
          profile: state.profile,
          flow: state.flow,
          message: page.querySelector('[data-simulation]').value
        });
        const trace = page.querySelector('[data-trace]');
        trace.hidden = false;
        trace.textContent = [...result.trace, result.output].filter(Boolean).join('\n') || 'Fluxo encerrado.';
        tell('Simulação concluída. Nenhuma mensagem foi enviada.');
      } else if (el === 'contacts' || el === 'consent') {
        const search = page.querySelector('[data-search]').value;
        if (el === 'consent') {
          const evidence =
            granted === 'true'
              ? ''
              : window.prompt('Onde e quando este contato autorizou mensagens de campanha?');
          if (granted !== 'true' && !evidence?.trim()) return;
          await api('consent', { id, granted: granted !== 'true', evidence });
          if (granted === 'true') recipients.delete(id);
        }
        contacts = (await api('contacts', { search })).contacts;
        showContacts();
      } else if (el === 'campaign') {
        if (!recipients.size) throw Error('Selecione os contatos com consentimento.');
        if (!window.confirm('Enfileirar o envio de WhatsApp para ' + recipients.size + ' contatos?')) return;
        await api('campaign', { ...campaignDraft, file: campaignFile, ids: [...recipients] });
        recipients.clear();
        campaignFile = null;
        campaignDraft = { title: '', message: '' };
        state.campaigns = (await api('load')).campaigns;
        render();
        tell('Campanha enfileirada.');
      } else if (el === 'campaign-jobs' || el === 'campaign-status') {
        const card = button.closest('[data-campaign]');
        if (el === 'campaign-status') {
          await api('campaignStatus', { id: card.dataset.campaign, status: button.dataset.status });
          state.campaigns = (await api('load')).campaigns;
          render();
        } else {
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
        }
      } else if (el === 'googleConnect') {
        location.assign((await api(el)).url);
      } else if (el === 'googleDisconnect') {
        await api(el);
        state.google = false;
        render();
      } else if (el === 'googleBook') {
        const value = key => page.querySelector(`[data-event="${key}"]`).value;
        if (!value('start') || !value('end')) throw Error('Informe início e fim.');
        const result = await api(el, {
          title: value('title'),
          start: new Date(value('start')).toISOString(),
          end: new Date(value('end')).toISOString()
        });
        tell('Compromisso criado.');
        if (result.hangoutLink) {
          const link = document.createElement('a');
          link.href = result.hangoutLink;
          link.textContent = ' Abrir Google Meet';
          link.target = '_blank';
          link.rel = 'noopener noreferrer';
          status.append(link);
        }
      } else if (el === 'googleEvents' || el === 'googleCancel') {
        if (el === 'googleCancel') {
          if (!window.confirm('Cancelar este compromisso no Google Agenda?')) return;
          await api(el, { id });
        }
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
            ${item.extendedProperties?.private?.siimob === 'elia' ? `<button class="btn btn-ghost" data-el="googleCancel" data-id="${q(item.id)}">Cancelar</button>` : ''}</li>`;
              })
              .join('') +
            '</ul>'
          : '<p>Sem compromissos no período.</p>';
      }
    } catch (error) {
      tell(error.message, true);
    } finally {
      button.disabled = false;
    }
  });

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
