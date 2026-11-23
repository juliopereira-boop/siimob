import { avaliar, intervaloCampanha } from '../atendimento-conectores/limites.mjs';
import { criarEvolution } from '../atendimento-conectores/evolution.mjs';
import { runFlow, validateFlow, qualificationFields } from './flow.mjs';
import { validarQualificacao } from './qualificacao.mjs';
import { authorization, calendar, digest, exchange, googleConfigured } from './google.ts';

const env = (name: string) => Deno.env.get(name) || '';
const base = env('SUPABASE_URL');
const origin = env('SIIMOB_ELIA_ORIGIN') || 'https://siimob.com';
const key = env('SUPABASE_SERVICE_ROLE_KEY');
const headers = { apikey: key, Authorization: 'Bearer ' + key, 'Content-Type': 'application/json' };
const cors = {
  'Access-Control-Allow-Origin': origin,
  'Access-Control-Allow-Headers': 'authorization, apikey, content-type, x-session-token, x-client-info',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  Vary: 'Origin'
};
const json = (value: unknown, status = 200) => Response.json(value, { status, headers: cors });
const eq = (value: string) => encodeURIComponent(value);
const uuid = (value: unknown) => typeof value === 'string' && /^[a-f0-9-]{36}$/i.test(value);
const clean = (value: unknown, length: number) =>
  typeof value === 'string' ? value.trim().slice(0, length) : '';

async function service(path: string, init: RequestInit = {}) {
  if (!base || !key) throw Error('Banco indisponível.');
  const result = await fetch(base + path, {
    ...init,
    headers: { ...headers, ...init.headers },
    signal: AbortSignal.timeout(12000)
  });
  if (!result.ok) throw Error('O banco recusou a operação.');
  const body = await result.text();
  return body ? JSON.parse(body) : null;
}
const read = (path: string) => service('/rest/v1/' + path);
const write = (path: string, method: string, data: unknown, prefer = 'return=minimal') =>
  service('/rest/v1/' + path, { method, body: JSON.stringify(data), headers: { Prefer: prefer } });
const rpc = (name: string, args = {}) => write('rpc/' + name, 'POST', args, 'return=representation');
const first = async (path: string) => (await read(path))?.[0];
const tenantFilter = (tenant: string) => 'tenant_id=eq.' + eq(tenant);
const configRow = (tenant: string) => first('a1_elia_config?' + tenantFilter(tenant));
const saveConfig = (tenant: string, data: Record<string, unknown>) =>
  write(
    'a1_elia_config?on_conflict=tenant_id',
    'POST',
    { tenant_id: tenant, ...data },
    'resolution=merge-duplicates,return=minimal'
  );
const evolution = criarEvolution({ url: env('SIIMOB_EVOLUTION_URL'), chave: env('SIIMOB_EVOLUTION_KEY') });
const mimeTypes = ['image/jpeg', 'image/png', 'image/webp', 'application/pdf'];

function attachment(value: any, tenant: string) {
  if (
    !value ||
    typeof value.path !== 'string' ||
    !value.path.startsWith(tenant + '/') ||
    !uuid(value.path.slice(tenant.length + 1)) ||
    !mimeTypes.includes(value.mime)
  )
    throw Error('Anexo inválido.');
  return { path: value.path, mime: value.mime, name: clean(value.name, 100) || 'Anexo' };
}

async function signed(file: any) {
  const data = await service('/storage/v1/object/sign/elia-private/' + file.path, {
    method: 'POST',
    body: JSON.stringify({ expiresIn: 300 })
  });
  if (typeof data?.signedURL !== 'string' || !data.signedURL.startsWith('/object/sign/'))
    throw Error('Anexo indisponível.');
  return base + '/storage/v1' + data.signedURL;
}

async function generate(tenant: string, config: any, input: string) {
  const row = await first('a1_ia_conexoes?' + tenantFilter(tenant) + '&select=chave,modelo,ativo');
  const secret = row?.chave || env('SIIMOB_OPENAI_API_KEY');
  if (!secret || row?.ativo === false) throw Error('Configure a OpenAI nas Integrações.');
  const knowledge = [
    config.treinamentos,
    config.produtos,
    config.empreendimentos?.map(({ titulo, descricao }: any) => ({ titulo, descricao }))
  ];
  const instructions = [
    'Você é ' + (config.nome || 'ELIA') + ', ' + (config.funcao || 'assistente imobiliária') + '.',
    'Ao qualificar um lead, identifique seu interesse, faixa de orçamento e prazo. Pergunte apenas o que estiver faltando.',
    'Use tom ' +
      (config.tom || 'normal') +
      ' e responda em português. Não invente dados nem confirme agendamentos sem execução.',
    config.comportamento || '',
    'Base da empresa: ' + JSON.stringify(knowledge).slice(0, 28000)
  ].join('\n');
  const response = await fetch('https://api.openai.com/v1/responses', {
    method: 'POST',
    headers: { Authorization: 'Bearer ' + secret, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      model: row?.modelo || 'gpt-4o-mini',
      instructions,
      input,
      store: false,
      max_output_tokens: 800
    }),
    signal: AbortSignal.timeout(25000),
    redirect: 'error'
  });
  if (!response.ok) throw Error('A OpenAI recusou a execução.');
  const result = await response.json();
  const output = result.output
    ?.flatMap((item: any) => (item.type === 'message' ? item.content : []))
    .filter((item: any) => item.type === 'output_text')
    .map((item: any) => item.text)
    .join('\n')
    .trim();
  if (!output) throw Error('A OpenAI não retornou texto.');
  return output;
}

async function book(tenant: string, row: any, body: any, id: string) {
  if (!row?.google_refresh) throw Error('Conecte o Google Agenda.');
  const start = new Date(body.start);
  const end = new Date(body.end);
  if (
    !Number.isFinite(+start) ||
    !(+end > +start) ||
    +start <= Date.now() ||
    +end - +start > 8 * 3600000 ||
    !clean(body.title, 100)
  )
    throw Error('Informe um horário futuro, duração e título.');
  const calId = row.config.calendario || 'primary';
  const google = await calendar(row.google_refresh, calId);
  const busy = await google('/freeBusy', 'POST', {
    timeMin: start.toISOString(),
    timeMax: end.toISOString(),
    items: [{ id: calId }]
  });
  const windows = Object.values(busy.calendars || {}) as any[];
  if (windows.length !== 1 || windows.some(item => item.errors?.length || item.busy?.length))
    throw Error('Horário indisponível.');
  const event = await google('?conferenceDataVersion=1', 'POST', {
    id,
    extendedProperties: { private: { siimob: 'elia' } },
    summary: clean(body.title, 100),
    start: { dateTime: start.toISOString() },
    end: { dateTime: end.toISOString() },
    ...(body.meet === false
      ? {}
      : {
          conferenceData: {
            createRequest: { requestId: id, conferenceSolutionKey: { type: 'hangoutsMeet' } }
          }
        })
  });
  await write(
    'a1_elia_appointment?on_conflict=id',
    'POST',
    { id, tenant_id: tenant, calendar_id: calId, event },
    'resolution=merge-duplicates,return=minimal'
  );
  return event;
}

const updateJob = (id: string, data: unknown) => write('a1_elia_job?id=eq.' + eq(id), 'PATCH', data);
const done = (id: string, status: string, detail = '') =>
  updateJob(id, { status, detail, finished_at: new Date().toISOString() });
const retryAt = (id: string, time: string, payload?: unknown) =>
  updateJob(id, { status: 'queued', run_at: time, ...(payload ? { payload } : {}) });
class Deferred extends Error {
  constructor(public until: string) {
    super('Envio adiado.');
  }
}

async function send(
  job: any,
  lead: any,
  text: string,
  type: 'resposta' | 'iniciado' | 'campanha',
  file?: any,
  author = 'ELIA'
) {
  const tenant = job.tenant_id;
  const wa = await first('a1_whatsapp_conexoes?' + tenantFilter(tenant) + '&select=estado,instancia');
  if (wa?.estado !== 'conectado') throw new Deferred(new Date(Date.now() + 300000).toISOString());
  const limit = avaliar({ uso: await rpc('a1_wa_uso', { p_tenant: tenant }), tipo: type });
  if (!limit.pode) {
    if (limit.pausarGeral)
      await rpc('a1_wa_pausar', { p_tenant: tenant, p_ate: limit.esperarAte, p_motivo: limit.motivo });
    throw new Deferred(limit.esperarAte!);
  }
  const number = String(lead.client_phone || '').replace(/\D/g, '');
  const formatted = /^\d{10,11}$/.test(number || '') ? '55' + number : number;
  if (!formatted || !text.trim()) throw Error('Mensagem ou telefone inválido.');
  let sent;
  try {
    sent = file
      ? await evolution.enviarMidia(
          wa.instancia,
          formatted,
          await signed(file),
          file.mime,
          file.name,
          text.slice(0, 900)
        )
      : await evolution.enviarTexto(wa.instancia, formatted, text.slice(0, 4000));
  } catch (error) {
    await rpc('a1_wa_registrar_falha', { p_tenant: tenant, p_tipo: type, p_atendimento: job.atendimento_id });
    throw error;
  }
  await rpc('a1_elia_log_send', {
    p_tenant: tenant,
    p_atendimento: job.atendimento_id,
    p_corpo: text.slice(0, 4000),
    p_autor: author,
    p_externo: sent.id,
    p_tipo: type,
    p_autor_tipo: 'ia'
  });
}

async function work(job: any) {
  const tenant = job.tenant_id;
  const scope = tenantFilter(tenant);
  const lead = await first(
    'a1_cases?' +
      scope +
      '&id=eq.' +
      eq(job.case_id) +
      '&module_key=eq.crm&select=id,client_name,client_phone'
  );
  if (!lead) return done(job.id, 'skipped', 'Lead removido.');
  if (job.campaign_id) {
    const campaign = await first('a1_elia_campaign?' + scope + '&id=eq.' + eq(job.campaign_id));
    if (campaign?.status === 'paused') return retryAt(job.id, new Date().toISOString());
    if (
      campaign?.status !== 'queued' ||
      !(await first(
        'a1_elia_consent?' +
          scope +
          '&case_id=eq.' +
          eq(lead.id) +
          '&phone=eq.' +
          eq(lead.client_phone || '') +
          '&select=case_id'
      ))
    ) {
      return done(job.id, 'skipped', 'Campanha cancelada ou consentimento revogado.');
    }
    const attempts = await read(
      'a1_elia_job?' +
        scope +
        '&campaign_id=eq.' +
        eq(campaign.id) +
        '&status=in.(sent,failed)&select=id&limit=500'
    );
    await write('a1_elia_campaign?id=eq.' + eq(campaign.id), 'PATCH', {
      next_at: new Date(Date.now() + intervaloCampanha(attempts.length + 1) * 1000).toISOString()
    });
    await send(
      job,
      lead,
      campaign.message.replace(/\{\{nome\}\}/g, lead.client_name || ''),
      'campanha',
      campaign.attachment
    );
    return done(job.id, 'sent');
  }
  const row = await configRow(tenant);
  if (job.payload.reminder) {
    if (
      !row?.enabled ||
      !row.config.agendamento ||
      !row.google_refresh ||
      !(await first(
        'a1_elia_consent?' +
          scope +
          '&case_id=eq.' +
          eq(lead.id) +
          '&phone=eq.' +
          eq(lead.client_phone) +
          '&select=case_id'
      ))
    )
      return done(job.id, 'skipped', 'Lembrete desativado ou sem consentimento.');
    const appointment = await first('a1_elia_appointment?' + scope + '&id=eq.' + eq(job.payload.reminder));
    if (!appointment) return done(job.id, 'skipped', 'Compromisso cancelado.');
    const google = await calendar(row.google_refresh, appointment.calendar_id);
    const event = await google('/calendars/' + eq(appointment.calendar_id) + '/events/' + eq(appointment.id));
    const start = new Date(event.start?.dateTime);
    if (event.status === 'cancelled' || !(+start > Date.now()))
      return done(job.id, 'skipped', 'Compromisso encerrado.');
    const when = +start - (row.config.lembrete || 60) * 60000;
    if (when > Date.now() + 1000) return retryAt(job.id, new Date(when).toISOString());
    const date = new Intl.DateTimeFormat('pt-BR', {
      timeZone: 'America/Sao_Paulo',
      dateStyle: 'short',
      timeStyle: 'short'
    }).format(start);
    await send(
      job,
      lead,
      'Lembrete: ' + event.summary + ' em ' + date + (event.hangoutLink ? '\n' + event.hangoutLink : ''),
      'iniciado'
    );
    return done(job.id, 'sent');
  }
  if (!row?.enabled || !row.config.canais?.includes('whatsapp'))
    return done(job.id, 'skipped', 'ELIA desativada no canal.');
  const conv = await first(
    'a1_atendimentos?' +
      scope +
      '&id=eq.' +
      eq(job.atendimento_id) +
      '&select=status,corretor_id,elia_ativa,versao'
  );
  if (!conv?.elia_ativa || conv.status !== 'aberta' || conv.corretor_id)
    return done(job.id, 'skipped', 'Atendimento humano.');
  const msg = await first(
    'a1_atendimento_mensagens?' + scope + '&id=eq.' + eq(job.message_id) + '&select=corpo,criado_em'
  );
  const recent = await read(
    'a1_atendimento_mensagens?' +
      scope +
      '&atendimento_id=eq.' +
      eq(job.atendimento_id) +
      '&tipo=eq.mensagem&order=criado_em.desc,id.desc&limit=10&select=id,autor_tipo,corpo,criado_em'
  );
  if (
    !msg ||
    recent.some(
      (item: any) => item.criado_em > msg.criado_em && ['lead', 'atendente'].includes(item.autor_tipo)
    )
  )
    return done(job.id, 'skipped', 'Conversa atualizada.');
  if (job.payload.flow && job.payload.flow !== JSON.stringify(row.flow))
    return done(job.id, 'skipped', 'Fluxo atualizado.');
  // Não deduza renda a partir de orçamento ou parcela. Só aceitamos respostas
  // acompanhadas de trecho literal escrito pelo lead, e o banco confere a
  // versão e se a ELIA ainda está atendendo antes de salvar.
  try {
    const prompt = [
      'Extraia exclusivamente dados explicitamente informados pelo lead, sem suposições.',
      'Responda somente JSON: cada chave pode conter {"valor":"texto","evidencia":"trecho literal escrito pelo lead"}.',
      'Chaves permitidas: nome, email, cpf, empreendimento, renda, cidade, tipo_imovel, quartos, orcamento, prazo, observacoes.',
      'Para nome, email e CPF, o valor deve ser idêntico ao trecho literal informado; não invente nem complete dados.',
      'Renda familiar só se o lead informar renda. Orçamento, valor do imóvel ou parcela não são renda.',
      'Use como evidência somente um trecho literal da última mensagem do lead; omita dados que não estejam nela.',
      'Não inclua campos ausentes. Não use falas da assistente como evidência.',
      JSON.stringify({conversa:recent.toReversed()})
    ].join('\n');
    const extracao = validarQualificacao(await generate(tenant, row.config, prompt), [{autor_tipo:'lead',corpo:msg.corpo}]);
    if (Object.keys(extracao).length) await rpc('a1_elia_qualificacao', {
      p_tenant: tenant, p_atendimento: job.atendimento_id, p_versao: conv.versao, p_mensagem: job.message_id, p_dados: extracao
    });
  } catch {
    console.warn('Não foi possível atualizar a qualificação pela ELIA.');
  }
  let waiting = false;
  let externalEffect = false;
  try {
    const qualificationLead = row.flow.some((node: any) => node.type === 'qualification')
      ? await first('a1_cases?' + scope + '&id=eq.' + eq(lead.id) + '&select=client_name,client_phone,client_email,client_cpf,payload')
      : null;
    const qualification = qualificationLead ? {
      ...qualificationLead.payload?.qualificacao,
      nome: qualificationLead.client_name,
      telefone: qualificationLead.client_phone,
      email: qualificationLead.client_email,
      cpf: qualificationLead.client_cpf
    } : {};
    await runFlow(
      row.flow,
      { name: lead.client_name, message: msg.corpo, ...job.payload, qualification },
      {
        ai: (prompt: string) =>
          generate(tenant, row.config, JSON.stringify({ tarefa: prompt, conversa: recent.toReversed() })),
        send: async (message: string) => {
          const current = await first(
            'a1_atendimentos?' + scope + '&id=eq.' + eq(job.atendimento_id) + '&select=elia_ativa,versao'
          );
          if (!current?.elia_ativa || current.versao !== conv.versao)
            throw Error('A conversa saiu do atendimento ELIA.');
          const type = +new Date(msg.criado_em) > Date.now() - 86400000 ? 'resposta' : 'iniciado';
          if (
            type === 'iniciado' &&
            (!row.config.followup ||
              !(await first(
                'a1_elia_consent?' +
                  scope +
                  '&case_id=eq.' +
                  eq(lead.id) +
                  '&phone=eq.' +
                  eq(lead.client_phone || '') +
                  '&select=case_id'
              )))
          )
            throw Error('Follow-up sem autorização.');
          await send(job, lead, message, type, null, row.config.nome || 'ELIA');
          externalEffect = true;
        },
        wait: async (resume: string, minutes: number, output: string) => {
          if (!row.config.followup) throw Error('Follow-up desativado.');
          waiting = true;
          await retryAt(job.id, new Date(Date.now() + minutes * 60000).toISOString(), {
            resume,
            output,
            flow: JSON.stringify(row.flow)
          });
        },
        handoff: (note: string) =>
          rpc('a1_elia_handoff', {
            p_tenant: tenant,
            p_atendimento: job.atendimento_id,
            p_note: note || 'Encaminhado pela ELIA para atendimento humano.',
            p_stage: row.config.pipeline,
            p_partner: row.config.responsavel
          }),
        roulette: async (nodeId: string) => {
          const result = await rpc('a1_elia_roleta', {
            p_tenant: tenant, p_atendimento: job.atendimento_id, p_versao: conv.versao,
            p_mensagem: job.message_id, p_no: nodeId
          });
          if (result !== 'distribuido') throw Error('Distribuição não concluída: ' + result);
          return '';
        },
        agenda: async (value: string) => {
          if (!row.config.agendamento) throw Error('Agendamento pela ELIA desativado.');
          const data = JSON.parse(value);
          const event = await book(tenant, row, data, job.id.replaceAll('-', ''));
          externalEffect = true;
          if (row.config.lembrete > 0) {
            const time = +new Date(event.start.dateTime) - row.config.lembrete * 60000;
            if (time > Date.now())
              await write('a1_elia_job', 'POST', {
                tenant_id: tenant,
                case_id: lead.id,
                atendimento_id: job.atendimento_id,
                run_at: new Date(time).toISOString(),
                payload: { reminder: event.id }
              });
          }
          return event.hangoutLink || event.htmlLink || 'Agendamento criado.';
        }
      }
    );
  } catch (error) {
    if (externalEffect && error instanceof Deferred) throw Error('Execução parcial. Revise a conversa.');
    throw error;
  }
  if (!waiting) await done(job.id, 'sent');
}

async function tick(request: Request) {
  const secret = env('SIIMOB_ELIA_WORKER_SECRET');
  if (!secret || request.headers.get('authorization') !== 'Bearer ' + secret)
    return json({ error: 'unauthorized' }, 401);
  const job = (await rpc('a1_elia_claim'))?.[0];
  if (!job) return json({ processed: false });
  try {
    await work(job);
  } catch (error) {
    if (
      error instanceof Deferred &&
      (job.campaign_id || Date.now() - new Date(job.run_at).getTime() < 86400000)
    ) {
      await retryAt(job.id, error.until);
    } else {
      await done(job.id, 'failed', 'A execução não foi concluída. Revise a configuração e a conversa.');
    }
  }
  return json({ processed: true });
}

function profile(input: any, tenant: string) {
  const records = (value: any) =>
    (Array.isArray(value) ? value : [])
      .slice(0, 40)
      .map(item => ({
        titulo: clean(item?.titulo, 120),
        descricao: clean(item?.descricao, 4000),
        fotos: (Array.isArray(item?.fotos) ? item.fotos : [])
          .slice(0, 10)
          .map((file: any) => attachment(file, tenant))
      }))
      .filter(item => item.titulo);
  return {
    nome: clean(input.nome, 100) || 'ELIA',
    funcao: clean(input.funcao, 100),
    tom: ['formal', 'normal', 'descontraída'].includes(input.tom) ? input.tom : 'normal',
    comportamento: clean(input.comportamento, 20000),
    canais: input.canais?.includes('whatsapp') ? ['whatsapp'] : [],
    treinamentos: records(input.treinamentos),
    produtos: records(input.produtos),
    empreendimentos: records(input.empreendimentos),
    imagens: records(input.imagens),
    agendamento: input.agendamento === true,
    lembrete: [0, 15, 30, 60, 1440].includes(Number(input.lembrete)) ? Number(input.lembrete) : 0,
    followup: input.followup === true,
    calendario: clean(input.calendario, 250) || 'primary',
    pipeline: uuid(input.pipeline) ? input.pipeline : null,
    responsavel: uuid(input.responsavel) ? input.responsavel : null
  };
}

async function confirmGoogle(url: URL) {
  const state = url.searchParams.get('state') || '';
  const code = url.searchParams.get('code') || '';
  const target = new URL('/', origin);
  try {
    if (!uuid(state)) throw Error('Autorização cancelada.');
    const hash = await digest(state);
    const rows = await write(
      'a1_elia_config?google_nonce=eq.' + hash + '&google_nonce_until=gt.' + eq(new Date().toISOString()),
      'PATCH',
      { google_nonce: null, google_nonce_until: null },
      'return=representation'
    );
    if (
      !rows?.[0] ||
      !(await rpc('a1_tenant_tem_modulo', { p_tenant: rows[0].tenant_id, p_modulo: 'ATENDIMENTO' }))
    )
      throw Error('Autorização expirada.');
    const company = await first('a1_tenants?id=eq.' + eq(rows[0].tenant_id) + '&select=slug');
    if (!/^[a-z0-9-]{1,100}$/.test(company?.slug || '')) throw Error('Empresa inválida.');
    target.pathname = '/' + company.slug + '/configuracoes';
    target.hash = 'integracoes';
    if (!code) throw Error('Autorização cancelada.');
    await saveConfig(rows[0].tenant_id, { google_refresh: await exchange(code) });
    target.searchParams.set('elia_google', 'conectado');
  } catch {
    target.searchParams.set('elia_google', 'erro');
  }
  return Response.redirect(target, 303);
}

Deno.serve(async request => {
  const url = new URL(request.url);
  try {
    if (request.method === 'GET') return await confirmGoogle(url);
    if (request.method === 'POST' && url.searchParams.get('worker') === '1') return await tick(request);
    if (request.headers.get('origin') !== origin) return json({ error: 'Origem inválida.' }, 403);
    if (request.method === 'OPTIONS') return new Response(null, { status: 204, headers: cors });
    if (request.method !== 'POST') return json({ error: 'Método inválido.' }, 405);
    const token = request.headers.get('x-session-token') || '';
    const user =
      token && token.length <= 512 ? (await rpc('a1_conector_contexto', { p_token: token }))?.[0] : null;
    if (!user?.gestor || !(await rpc('a1_elia_admin', { p_token: token })))
      return json({ error: 'Acesso reservado à gestão do módulo Atendimento.' }, 403);
    const tenant = user.tenant_id;
    const scope = tenantFilter(tenant);
    const raw = await request.text();
    if (raw.length > 7100000) return json({ error: 'Arquivo muito grande.' }, 413);
    const body = JSON.parse(raw);
    const row = await configRow(tenant);
    switch (body.action) {
      case 'load': {
        const [campaigns, jobs, stages, partners] = await Promise.all([
          read(
            'a1_elia_campaign?' +
              scope +
              '&select=id,title,status,next_at,created_at&order=created_at.desc&limit=30'
          ),
          read(
            'a1_elia_job?' +
              scope +
              '&campaign_id=is.null&select=id,status,detail,run_at&order=run_at.desc&limit=15'
          ),
          read('a1_stages?' + scope + '&module_key=eq.crm&select=id,name&order=position'),
          read('a1_partners?' + scope + '&type=eq.corretor&select=id,name&order=name&limit=300')
        ]);
        return json({
          profile: row?.config || {},
          flow: row?.flow || [],
          enabled: row?.enabled || false,
          google: Boolean(row?.google_refresh),
          googleReady: googleConfigured,
          campaigns,
          jobs,
          stages,
          partners
        });
      }
      case 'save': {
        if (body.enabled || body.flow?.length) validateFlow(body.flow);
        const settings = profile(body.profile || {}, tenant);
        for (const [value, relation] of [
          [settings.pipeline, 'a1_stages'],
          [settings.responsavel, 'a1_partners']
        ]) {
          if (value && !(await first(relation + '?' + scope + '&id=eq.' + eq(value) + '&select=id')))
            throw Error('Etapa ou responsável inválido.');
        }
        await saveConfig(tenant, { config: settings, enabled: body.enabled === true, flow: body.flow || [] });
        return json({ ok: true });
      }
      case 'simulate': {
        const input = clean(body.message, 4000);
        if (!input) throw Error('Escreva uma mensagem de teste.');
        const trace: string[] = [];
        const output = await runFlow(
          body.flow,
          { message: input, name: 'Lead de teste', qualification: Object.fromEntries(qualificationFields.map((field: string) => [field, clean(body.qualification?.[field], 500)])) },
          {
            ai: async (task: string) =>
              generate(tenant, profile(body.profile || {}, tenant), JSON.stringify({ task, input })),
            send: (value: string) => trace.push('WhatsApp: ' + value),
            agenda: (value: string) => {
              trace.push('Agenda: ' + value);
              return 'Agendamento simulado';
            },
            wait: (_next: string, minutes: number) => trace.push('Aguardar ' + minutes + ' min'),
            handoff: (value: string) => trace.push('Atendimento humano: ' + value),
            continuar: () => trace.push('Faltam dados: continua com a ELIA na próxima mensagem do lead.'),
            roulette: (id: string) => {
              const node = body.flow.find((item: any) => item.id === id);
              const missing = node.fields.filter((field: string) => !clean(body.qualification?.[field], 500));
              trace.push(missing.length
                ? 'Distribuição não realizada: dados obrigatórios faltando: ' + missing.join(', ')
                : 'Distribuição pela roleta simulada; nenhum lead foi atribuído.');
            }
          }
        );
        return json({ trace, output: typeof output === 'string' ? output : '' });
      }
      case 'upload': {
        if (!mimeTypes.includes(body.mime) || typeof body.data !== 'string' || body.data.length > 6990508)
          throw Error('Envie PNG, JPG, WebP ou PDF de até 5 MB.');
        const bytes = Uint8Array.from(atob(body.data), char => char.charCodeAt(0));
        if (bytes.length > 5242880 || !bytes.length) throw Error('Arquivo inválido.');
        const path = tenant + '/' + crypto.randomUUID();
        await service('/storage/v1/object/elia-private/' + path, {
          method: 'POST',
          body: bytes,
          headers: { 'Content-Type': body.mime }
        });
        return json(attachment({ path, mime: body.mime, name: body.name }, tenant));
      }
      case 'asset':
        return json({ url: await signed(attachment(body.file, tenant)) });
      case 'contacts': {
        const needle = clean(body.search, 80).replace(/[*,().%]/g, ' ');
        const contacts = await read(
          'a1_cases?' +
            scope +
            '&module_key=eq.crm&client_phone=not.is.null' +
            '&select=id,client_name,client_phone&order=client_name.asc&limit=100' +
            (needle ? '&client_name=ilike.*' + eq(needle) + '*' : '')
        );
        const ids = contacts.map((item: any) => item.id);
        const consent = ids.length
          ? await read(
              'a1_elia_consent?' + scope + '&select=case_id,phone&case_id=in.(' + ids.join(',') + ')'
            )
          : [];
        const allowed = new Map(consent.map((item: any) => [item.case_id, item.phone]));
        return json({
          contacts: contacts.map((item: any) => ({
            ...item,
            consent: allowed.get(item.id) === item.client_phone
          }))
        });
      }
      case 'consent': {
        const lead =
          uuid(body.id) &&
          (await first(
            'a1_cases?' + scope + '&module_key=eq.crm&id=eq.' + eq(body.id) + '&select=id,client_phone'
          ));
        if (!lead?.client_phone) throw Error('Contato inválido.');
        if (body.granted) {
          const evidence = clean(body.evidence, 500);
          if (!evidence) throw Error('Registre a origem do consentimento.');
          await write(
            'a1_elia_consent?on_conflict=tenant_id,case_id',
            'POST',
            {
              tenant_id: tenant,
              case_id: body.id,
              evidence,
              phone: lead.client_phone,
              recorded_at: new Date().toISOString()
            },
            'resolution=merge-duplicates,return=minimal'
          );
        } else await write('a1_elia_consent?' + scope + '&case_id=eq.' + eq(body.id), 'DELETE', null);
        return json({ ok: true });
      }
      case 'campaign': {
        const title = clean(body.title, 120);
        const message = clean(body.message, 4000);
        const file = body.file ? attachment(body.file, tenant) : null;
        if (
          !title ||
          !message ||
          (file && message.length > 900) ||
          !Array.isArray(body.ids) ||
          !body.ids.length ||
          body.ids.length > 500 ||
          !body.ids.every(uuid)
        )
          throw Error('Confira título, texto, anexo e contatos.');
        await rpc('a1_elia_start_campaign', {
          p_tenant: tenant,
          p_title: title,
          p_message: message,
          p_attachment: file,
          p_cases: body.ids
        });
        return json({ ok: true });
      }
      case 'campaignStatus': {
        if (!uuid(body.id) || !['queued', 'paused', 'cancelled'].includes(body.status))
          throw Error('Campanha inválida.');
        await write(
          'a1_elia_campaign?' + scope + '&id=eq.' + eq(body.id) + '&status=neq.cancelled',
          'PATCH',
          { status: body.status }
        );
        if (body.status === 'cancelled')
          await write(
            'a1_elia_job?' + scope + '&campaign_id=eq.' + eq(body.id) + '&status=eq.queued',
            'PATCH',
            { status: 'skipped', detail: 'Campanha cancelada.', finished_at: new Date().toISOString() }
          );
        return json({ ok: true });
      }
      case 'campaignJobs': {
        if (!uuid(body.id)) throw Error('Campanha inválida.');
        return json(
          await read(
            'a1_elia_job?' +
              scope +
              '&campaign_id=eq.' +
              eq(body.id) +
              '&select=id,status,detail,case_id,a1_cases(client_name)&limit=500'
          )
        );
      }
      case 'googleConnect': {
        const nonce = crypto.randomUUID();
        const link = authorization(nonce);
        await saveConfig(tenant, {
          google_nonce: await digest(nonce),
          google_nonce_until: new Date(Date.now() + 600000).toISOString()
        });
        return json({ url: link });
      }
      case 'googleDisconnect':
        await saveConfig(tenant, { google_refresh: null, google_nonce: null, google_nonce_until: null });
        return json({ ok: true });
      case 'googleEvents': {
        if (!row?.google_refresh) throw Error('Conecte o Google Agenda.');
        const google = await calendar(row.google_refresh, row.config.calendario || 'primary');
        const start = new Date(body.start);
        const end = new Date(body.end);
        if (!Number.isFinite(+start) || !(+end > +start) || +end - +start > 32 * 86400000)
          throw Error('Período inválido.');
        const search = new URLSearchParams({
          timeMin: start.toISOString(),
          timeMax: end.toISOString(),
          singleEvents: 'true',
          orderBy: 'startTime',
          maxResults: '250'
        });
        const data = await google('?' + search);
        return json(data.items || []);
      }
      case 'googleBook':
        return json(await book(tenant, row, body, crypto.randomUUID().replaceAll('-', '')));
      case 'googleCancel': {
        if (!/^[0-9a-f]{32}$/.test(body.id)) throw Error('Evento inválido.');
        const item = await first('a1_elia_appointment?' + scope + '&id=eq.' + eq(body.id));
        if (!item || !row?.google_refresh) throw Error('Evento indisponível.');
        const google = await calendar(row.google_refresh, item.calendar_id);
        await google('/calendars/' + eq(item.calendar_id) + '/events/' + eq(item.id), 'DELETE');
        await write('a1_elia_appointment?' + scope + '&id=eq.' + eq(item.id), 'DELETE', null);
        return json({ ok: true });
      }
      default:
        return json({ error: 'Ação inválida.' }, 400);
    }
  } catch (error) {
    return json(
      {
        error:
          error instanceof Error && !['TypeError', 'SyntaxError'].includes(error.name)
            ? error.message.slice(0, 150)
            : 'Não foi possível concluir.'
      },
      400
    );
  }
});
