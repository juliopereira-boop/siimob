// @ts-check
// ─── OpenAI e WhatsApp (Configurações › Integrações) ─────────────────────────
//
// O PEDIDO DO DONO
//   "ja crie o ambiente, para integrar com a llm, por enquanto usarei da
//    openai, coloque dentro da configuraçao de integracoes, ao lado da meta."
//   "eu vou integrar o evolution por enquanto (...) ja prepare essa integração
//    com o whatsapp tambem."
//
// Os dois fazem parte do pacote da Central de atendimento (módulo
// ATENDIMENTO): sem a licença, os cartões não entram no DOM. Só o gestor vê.
// Toda a conversa passa pela Edge Function atendimento-conectores, com a
// sessão (x-session-token). A chave da OpenAI nunca volta para a tela (só os 4
// últimos caracteres); a chave da Evolution e o token do aviso nem saem do
// servidor.
import { A1, A1_URL } from '../../shared/api/config.js';
import { esc } from '../../shared/utils/texto.js';

const $ = (/** @type {string} */ id) => /** @type {HTMLElement} */ (document.getElementById(id));
/** @type {any} */
let estado = null;
/** @type {string[]} */
let modelos = [];
/** @type {ReturnType<typeof setInterval>|null} */
let vigia = null;

const ERROS = /** @type {Record<string,string>} */ ({
  chave_invalida: 'Chave em formato inválido. A chave da OpenAI começa com "sk-".',
  chave_recusada: 'A OpenAI recusou esta chave. Confira se ela está ativa e tem crédito.',
  openai_indisponivel: 'A OpenAI não respondeu agora. Tente de novo em instantes.',
  sem_chave: 'Informe a chave da OpenAI da empresa.',
  servidor_nao_configurado:
    'O servidor do WhatsApp (Evolution) ainda não foi configurado no SIIMOB. Fale com o suporte.',
  servidor_sem_resposta: 'O servidor do WhatsApp não respondeu. Tente de novo em instantes.',
  chave_recusada_evolution: 'O servidor do WhatsApp recusou a chave da plataforma.',
  erro_evolution: 'O servidor do WhatsApp recusou o pedido. Tente de novo em instantes.',
  not_connected: 'O WhatsApp ainda não foi conectado.',
  forbidden: 'Só o gestor da empresa mexe nas integrações.',
  temporarily_unavailable: 'Não foi possível concluir agora. Tente de novo em instantes.'
});

async function chamar(/** @type {string} */ action, params = {}, espera = 20000) {
  /** @type {Response} */
  let r;
  try {
    r = await fetch(`${A1_URL}/functions/v1/atendimento-conectores`, {
      method: 'POST',
      headers: A1.headers(),
      body: JSON.stringify({ action, ...params }),
      signal: AbortSignal.timeout(espera)
    });
  } catch {
    throw new Error('Não foi possível falar com o servidor agora. Confira a internet e tente de novo.');
  }
  const b = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(ERROS[b && b.error] || 'Não foi possível concluir agora. Tente de novo.');
  return b;
}

const fone = (/** @type {string|null} */ n) => {
  const d = String(n || '').replace(/\D/g, '');
  const m = /^55(\d{2})(\d{4,5})(\d{4})$/.exec(d);
  return m ? `+55 (${m[1]}) ${m[2]}-${m[3]}` : d ? `+${d}` : '';
};
const horaDe = (/** @type {string|null} */ iso) =>
  iso
    ? new Date(iso).toLocaleString('pt-BR', {
        day: '2-digit',
        month: '2-digit',
        hour: '2-digit',
        minute: '2-digit'
      })
    : '';

function aviso(/** @type {string} */ id, msg = '', ok = false) {
  const el = document.getElementById(id);
  if (!el) return;
  el.hidden = !msg;
  el.textContent = msg;
  el.classList.toggle('mi-aviso-ok', ok);
}

const SVG_IA =
  '<svg width="48" height="48" viewBox="0 0 48 48" aria-hidden="true"><rect width="48" height="48" rx="12" fill="#10231f"/><path d="M24 11l2.6 7.4L34 21l-7.4 2.6L24 31l-2.6-7.4L14 21l7.4-2.6z" fill="#7fe0c9"/><path d="M33 29l1.2 3.3L37.5 33.5l-3.3 1.2L33 38l-1.2-3.3-3.3-1.2 3.3-1.2z" fill="#fff"/></svg>';
const SVG_WA =
  '<svg width="48" height="48" viewBox="0 0 48 48" aria-hidden="true"><rect width="48" height="48" rx="12" fill="#25d366"/><path fill="#fff" d="M24 10a14 14 0 0 0-12 21.2L10 38l7-1.8A14 14 0 1 0 24 10zm7.6 19.5c-.3.9-1.8 1.7-2.5 1.7-.7.1-1.4.3-4.6-1-3.9-1.5-6.4-5.6-6.6-5.9-.2-.3-1.5-2.1-1.5-3.9s1-2.8 1.3-3.2c.3-.4.7-.4 1-.4h.7c.2 0 .5 0 .8.7l1.2 2.9c.1.3.1.5 0 .8l-.6.8-.5.6c-.2.2-.4.4-.2.8.3.4 1.1 1.8 2.3 2.9 1.5 1.4 2.8 1.8 3.2 2 .4.2.7.1.9-.1l1.3-1.5c.3-.4.6-.3.9-.2l2.8 1.3c.4.2.7.3.8.5.1.2.1 1-.2 1.9z"/></svg>';

/** Põe os dois cartões em Integrações. Chamar só com a licença confirmada. */
export function conectoresMontar() {
  const vista = document.getElementById('cfg-view-integracoes');
  if (!vista || document.getElementById('conectores')) return;
  const box = document.createElement('div');
  box.id = 'conectores';
  box.className = 'mi-conectores';
  box.innerHTML = `
    <div class="mi-pacote">Pacote Central de atendimento</div>
    <div id="ia-card" class="mi-cartao">
      <div class="mi-topo">
        <span class="mi-logo">${SVG_IA}</span>
        <div class="mi-nome"><b>OpenAI</b><small>A inteligência da ELIA: conversa, qualifica e responde os leads</small></div>
        <span id="ia-selo" class="mi-selo mi-selo-verificando" role="status"><i aria-hidden="true"></i><span>Verificando</span></span>
      </div>
      <p id="ia-resumo" class="mi-resumo">Informe a chave da OpenAI da empresa. Ela fica guardada só no servidor: aqui aparecem apenas os 4 últimos caracteres.</p>
      <div class="mi-form">
        <label class="mi-campo"><span>Chave da OpenAI</span>
          <input id="ia-chave" type="password" autocomplete="off" spellcheck="false" placeholder="sk-..." data-lgpd-livre maxlength="300"></label>
        <label class="mi-campo"><span>Modelo</span>
          <select id="ia-modelo"></select></label>
      </div>
      <div class="mi-acoes">
        <button id="ia-salvar" type="button" class="btn btn-primary" data-acao="iaSalvar">Salvar</button>
        <button id="ia-testar" type="button" class="btn btn-ghost" data-acao="iaTestar">Testar conexão</button>
        <button id="ia-plataforma" type="button" class="btn btn-ghost" data-acao="iaUsarPlataforma" hidden>Usar a chave do SIIMOB</button>
      </div>
      <p id="ia-aviso" class="mi-aviso" role="status" hidden></p>
    </div>

    <div id="wa-card" class="mi-cartao">
      <div class="mi-topo">
        <span class="mi-logo">${SVG_WA}</span>
        <div class="mi-nome"><b>WhatsApp</b><small>Número da empresa conectado por QR Code (Evolution)</small></div>
        <span id="wa-selo" class="mi-selo mi-selo-verificando" role="status"><i aria-hidden="true"></i><span>Verificando</span></span>
      </div>
      <p id="wa-resumo" class="mi-resumo"></p>
      <div id="wa-qr" class="mi-qr" hidden></div>
      <div id="wa-painel" hidden></div>
      <div class="mi-acoes">
        <button id="wa-conectar" type="button" class="btn btn-primary" data-acao="waConectar" hidden>Conectar WhatsApp</button>
        <button id="wa-conferir" type="button" class="btn btn-ghost" data-acao="waConferir" hidden>Conferir conexão</button>
        <button id="wa-desconectar" type="button" class="btn btn-ghost mi-perigo" data-acao="waDesconectar" hidden>Desconectar</button>
      </div>
      <p id="wa-aviso" class="mi-aviso" role="status" hidden></p>
      <details class="mi-limites">
        <summary>Como o SIIMOB protege o número</summary>
        <p>Esta conexão não é a API oficial do WhatsApp. O WhatsApp não publica limites para ela, e nenhum limite garante que o número não seja bloqueado. Para reduzir o risco, o SIIMOB:</p>
        <ul>
          <li>separa <b>respostas</b> (o lead escreveu nas últimas 24 h, risco baixo) de <b>conversas iniciadas e campanhas</b> (risco alto);</li>
          <li>aquece o número: conversas iniciadas/campanha começam em 20 por dia e sobem aos poucos até 250 por dia depois de 30 dias;</li>
          <li>limita o ritmo (até 8 por minuto, 150 por hora) e, em campanha, espera de 20 a 60 s entre mensagens, com pausa de 5 a 15 min a cada 20;</li>
          <li>pausa sozinho ao chegar no limite ou depois de falhas seguidas, avisa aqui e na Central, e volta quando abrir vaga.</li>
        </ul>
        <p>Evite mandar o mesmo texto para muita gente e listas de quem nunca falou com a empresa.</p>
      </details>
    </div>`;
  vista.appendChild(box);
}

// ─── Estado ──────────────────────────────────────────────────────────────────
export async function conectoresCarregar(conferir = false) {
  if (!document.getElementById('conectores')) return;
  try {
    estado = await chamar('status', { conferir });
    pintarIa();
    pintarWa();
  } catch (e) {
    aviso('ia-aviso', /** @type {Error} */ (e).message);
    selo('ia-selo', 'off', 'Indisponível');
    selo('wa-selo', 'off', 'Indisponível');
  }
}

function selo(/** @type {string} */ id, /** @type {string} */ tipo, /** @type {string} */ texto) {
  const el = document.getElementById(id);
  if (!el) return;
  el.className = `mi-selo mi-selo-${tipo}`;
  const t = el.querySelector('span');
  if (t) t.textContent = texto;
}

function pintarIa() {
  const ia = estado && estado.ia;
  if (!ia) return;
  if (!ia.configurada) selo('ia-selo', 'off', 'Não configurada');
  else if (ia.teste_ok === false) selo('ia-selo', 'expirou', 'Chave recusada');
  else selo('ia-selo', 'ok', ia.propria ? 'Conectada' : 'Chave do SIIMOB');
  $('ia-resumo').textContent = ia.propria
    ? `Chave da empresa terminada em ${ia.final}. Para trocar, cole a nova chave e salve.`
    : ia.plataforma_disponivel
      ? 'Usando a chave do SIIMOB. Se preferir que o consumo saia na conta da empresa, cole aqui a chave da OpenAI da empresa.'
      : 'Informe a chave da OpenAI da empresa. Ela fica guardada só no servidor: aqui aparecem apenas os 4 últimos caracteres.';
  /** @type {HTMLInputElement} */ ($('ia-chave')).placeholder = ia.propria ? `sk-...${ia.final}` : 'sk-...';
  $('ia-plataforma').hidden = !(ia.propria && ia.plataforma_disponivel);
  const lista = [...new Set([ia.modelo, ...modelos].filter(Boolean))];
  $('ia-modelo').innerHTML = lista
    .map(m => `<option value="${esc(m)}"${m === ia.modelo ? ' selected' : ''}>${esc(m)}</option>`)
    .join('');
}

function pintarWa() {
  const w = estado && estado.whatsapp;
  if (!w) return;
  const btn = (/** @type {string} */ id, mostra = true) => ($(id).hidden = !mostra);
  if (!w.servidor_configurado) {
    selo('wa-selo', 'off', 'Aguardando servidor');
    $('wa-resumo').textContent =
      'O servidor do WhatsApp (Evolution) ainda não foi ligado ao SIIMOB. Assim que estiver, o botão de conectar aparece aqui.';
    btn('wa-conectar', false);
    btn('wa-conferir', false);
    btn('wa-desconectar', false);
    $('wa-painel').hidden = true;
    $('wa-qr').hidden = true;
    return;
  }
  const e = w.estado;
  const conectado = e === 'conectado';
  selo(
    'wa-selo',
    conectado
      ? w.pausado_ate
        ? 'inativa'
        : 'ok'
      : e === 'aguardando_qr' || e === 'conectando'
        ? 'verificando'
        : 'off',
    conectado
      ? w.pausado_ate
        ? 'Pausado'
        : 'Conectado'
      : e === 'aguardando_qr'
        ? 'Aguardando QR'
        : e === 'conectando'
          ? 'Conectando'
          : 'Não conectado'
  );
  $('wa-resumo').textContent = conectado
    ? `Conectado${w.perfil_nome ? ` como ${w.perfil_nome}` : ''}. As mensagens dos leads chegam na Central de atendimento e as respostas saem por este número.`
    : e === 'aguardando_qr' || e === 'conectando'
      ? 'Abra o WhatsApp do número da empresa › Aparelhos conectados › Conectar um aparelho, e aponte para o QR Code.'
      : 'Conecte o número de WhatsApp da empresa. Use um número só para a empresa, de preferência já usado há algum tempo.';
  btn('wa-conectar', !conectado);
  $('wa-conectar').textContent = e === 'aguardando_qr' ? 'Gerar QR Code de novo' : 'Conectar WhatsApp';
  btn('wa-conferir', !conectado && e !== 'nao_criado' && e !== 'desconectado');
  btn('wa-desconectar', e !== 'nao_criado' && e !== 'desconectado');
  if (conectado) {
    $('wa-qr').hidden = true;
    pararVigia();
  }
  const painel = $('wa-painel');
  painel.hidden = !conectado;
  if (!conectado) return;
  const u = w.uso || {};
  const a = w.aquecimento || {};
  const barra = (/** @type {number} */ v, /** @type {number} */ t) => {
    const p = t ? Math.min(100, Math.round((v / t) * 100)) : 0;
    return `<span class="mi-barra${p >= 80 ? ' mi-barra-alerta' : ''}" role="progressbar" aria-valuenow="${p}" aria-valuemin="0" aria-valuemax="100"><i style="width:${p}%"></i></span>`;
  };
  painel.innerHTML = `
    ${w.pausado_ate ? `<p class="mi-faixa" role="alert">Envios pausados até ${esc(horaDe(w.pausado_ate))} para proteger o número. ${esc(w.pausa_motivo || '')} Volta sozinho.</p>` : ''}
    ${!w.pausado_ate && w.alerta ? '<p class="mi-faixa" role="status">O número está perto do limite seguro de hoje. Os envios continuam, com cuidado; ao chegar no limite, o SIIMOB pausa sozinho.</p>' : ''}
    ${!w.pausado_ate && w.disparo && !w.disparo.pode ? `<p class="mi-faixa" role="status">${esc(w.disparo.motivo || '')}${w.disparo.volta_em ? ` Volta às ${esc(horaDe(w.disparo.volta_em))}.` : ''}</p>` : ''}
    <div class="mi-wa-dados">
      <div><span>Número</span><b>${esc(fone(w.numero))}</b></div>
      <div><span>Aquecimento</span><b>${esc(a.rotulo || '')}</b><small>dia ${esc(String(a.dias || 1))} no SIIMOB</small></div>
    </div>
    <div class="mi-uso">
      <div><span>Conversas iniciadas e campanha hoje</span><b>${esc(String(u.frio_hoje || 0))} de ${esc(String(a.por_dia || 0))}</b>${barra(u.frio_hoje || 0, a.por_dia || 0)}</div>
      <div><span>Todas as mensagens enviadas hoje</span><b>${esc(String(u.hoje || 0))} de ${esc(String(u.teto_dia || 0))}</b>${barra(u.hoje || 0, u.teto_dia || 0)}</div>
      <div><span>Na última hora</span><b>${esc(String(u.hora || 0))} de ${esc(String(u.teto_hora || 0))}</b>${barra(u.hora || 0, u.teto_hora || 0)}</div>
    </div>
    <label class="mi-opcao"><input type="checkbox" id="wa-criar-leads" data-acao-change="waCriarLeads" ${w.criar_leads ? 'checked' : ''}>
      <span>Criar lead quando um número novo escrever <small>Desligado, só conversas de leads que já existem entram na Central.</small></span></label>`;
}

// ─── OpenAI ──────────────────────────────────────────────────────────────────
export async function iaSalvar() {
  const campo = /** @type {HTMLInputElement} */ ($('ia-chave'));
  const chave = campo.value.trim();
  const modelo = /** @type {HTMLSelectElement} */ ($('ia-modelo')).value || undefined;
  const b = /** @type {HTMLButtonElement} */ ($('ia-salvar'));
  b.disabled = true;
  aviso('ia-aviso', chave ? 'Testando a chave na OpenAI...' : 'Salvando...', true);
  try {
    const r = await chamar('ia_salvar', chave ? { chave, modelo } : { modelo });
    campo.value = '';
    estado = { ...estado, ia: r.ia };
    pintarIa();
    aviso('ia-aviso', chave ? 'Chave conferida e salva.' : 'Modelo salvo.', true);
  } catch (e) {
    aviso('ia-aviso', /** @type {Error} */ (e).message);
  } finally {
    b.disabled = false;
  }
}

export async function iaTestar() {
  const b = /** @type {HTMLButtonElement} */ ($('ia-testar'));
  b.disabled = true;
  aviso('ia-aviso', 'Testando...', true);
  try {
    const r = await chamar('ia_testar');
    estado = { ...estado, ia: r.ia };
    if (r.ok) {
      modelos = Array.isArray(r.modelos) ? r.modelos : [];
      if (r.sugerido && !estado.ia.teste_ok) estado.ia.modelo = r.sugerido;
      pintarIa();
      aviso(
        'ia-aviso',
        `Conexão com a OpenAI funcionando. ${modelos.length} modelo(s) disponível(is) na conta.`,
        true
      );
    } else {
      pintarIa();
      aviso('ia-aviso', ERROS[r.erro] || 'A OpenAI não aceitou a conexão.');
    }
  } catch (e) {
    aviso('ia-aviso', /** @type {Error} */ (e).message);
  } finally {
    b.disabled = false;
  }
}

export async function iaUsarPlataforma() {
  if (!confirm('Apagar a chave da empresa e usar a chave do SIIMOB?')) return;
  try {
    const r = await chamar('ia_salvar', { chave: null });
    estado = { ...estado, ia: r.ia };
    pintarIa();
    aviso('ia-aviso', 'Chave da empresa apagada. Usando a chave do SIIMOB.', true);
  } catch (e) {
    aviso('ia-aviso', /** @type {Error} */ (e).message);
  }
}

// ─── WhatsApp ────────────────────────────────────────────────────────────────
function pararVigia() {
  if (vigia) clearInterval(vigia);
  vigia = null;
}

export async function waConectar() {
  const b = /** @type {HTMLButtonElement} */ ($('wa-conectar'));
  b.disabled = true;
  aviso('wa-aviso', 'Preparando a conexão...', true);
  try {
    const r = await chamar('wa_conectar', {}, 30000);
    estado = { ...estado, whatsapp: r.whatsapp };
    pintarWa();
    const qr = $('wa-qr');
    if (r.qr) {
      const img = document.createElement('img');
      img.src = r.qr; // a função só devolve data:image/png;base64 conferido
      img.alt = 'QR Code para conectar o WhatsApp';
      img.width = 240;
      img.height = 240;
      qr.replaceChildren(img);
      if (r.codigo) {
        const p = document.createElement('p');
        p.textContent = `Ou, no celular, "Conectar com número de telefone" e use o código ${r.codigo}`;
        qr.appendChild(p);
      }
      qr.hidden = false;
      aviso('wa-aviso', '');
    } else {
      qr.hidden = true;
      aviso('wa-aviso', 'O servidor não devolveu o QR Code. Clique em "Conferir conexão" ou gere de novo.');
    }
    // Confere sozinho a cada 4 s por até 2 min, até conectar.
    pararVigia();
    let voltas = 0;
    vigia = setInterval(async () => {
      if (++voltas > 30 || !document.getElementById('wa-card')) return pararVigia();
      await conectoresCarregar(true).catch(() => {});
      if (estado && estado.whatsapp && estado.whatsapp.estado === 'conectado') {
        pararVigia();
        aviso('wa-aviso', 'WhatsApp conectado.', true);
      }
    }, 4000);
  } catch (e) {
    aviso('wa-aviso', /** @type {Error} */ (e).message);
  } finally {
    b.disabled = false;
  }
}

export async function waConferir() {
  await conectoresCarregar(true);
}

export async function waDesconectar() {
  if (
    !confirm(
      'Desconectar o WhatsApp da empresa? As mensagens deixam de chegar na Central e as respostas voltam a abrir no WhatsApp Web.'
    )
  )
    return;
  try {
    const r = await chamar('wa_desconectar', {}, 30000);
    pararVigia();
    estado = { ...estado, whatsapp: r.whatsapp };
    $('wa-qr').hidden = true;
    pintarWa();
    aviso('wa-aviso', 'WhatsApp desconectado.', true);
  } catch (e) {
    aviso('wa-aviso', /** @type {Error} */ (e).message);
  }
}

export async function waCriarLeads(/** @type {HTMLElement} */ el) {
  const marcado = /** @type {HTMLInputElement} */ (el).checked;
  try {
    const r = await chamar('wa_opcoes', { criar_leads: marcado });
    estado = { ...estado, whatsapp: r.whatsapp };
    aviso(
      'wa-aviso',
      marcado ? 'Número novo que escrever vira lead.' : 'Só leads que já existem entram na Central.',
      true
    );
  } catch (e) {
    /** @type {HTMLInputElement} */ (el).checked = !marcado;
    aviso('wa-aviso', /** @type {Error} */ (e).message);
  }
}
