// ─── atendimento-conectores: OpenAI e WhatsApp da Central ────────────────────
//
// Quem chama: a tela de Configurações › Integrações (gestor) e a Central de
// atendimento (gestor ou corretor dono da conversa, só para enviar).
// WhatsApp: o oficial (API da Meta pela Coexy) é o principal; a Evolution
// (QR) fica de reserva automática (rota.mjs).
// Tudo que é segredo (chave da OpenAI, chave da Evolution, chave da Coexy,
// token do canal, token do aviso) fica aqui no servidor. A tela recebe só o
// estado e os 4 últimos caracteres da chave.
//
// Dependências injetadas: o handler não fala com banco nem com a rede direto,
// para os testes rodarem isolados (testes/conectores/*.test.mjs).
import { avaliar, faseAquecimento, MOTIVO_TEXTO, TETOS } from './limites.mjs';
import { ErroEvolution } from './evolution.mjs';
import { ErroCoexy, preencher, variaveis } from './coexy.mjs';
import { enviarWhatsapp, ErroEnvio } from './rota.mjs';

const origem = 'https://siimob.com';
const CHAVE_OPENAI = /^sk-[A-Za-z0-9_-]{16,250}$/;
const MODELO = /^[a-zA-Z0-9._:-]{2,60}$/;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
// Modelos preferidos, em ordem: o primeiro que a conta tiver vira o padrão.
const PREFERIDOS = ['gpt-4.1-mini', 'gpt-4o-mini', 'gpt-5-mini', 'gpt-4.1', 'gpt-4o'];
const NOME_MODELO = /^[a-z0-9_]{1,60}$/;
const IDIOMA = /^[a-z]{2}(_[A-Z]{2})?$/;
// Avisos que o SIIMOB assina na Coexy (um webhook para a plataforma inteira).
export const EVENTOS_COEXY = [
  'messages',
  'smb_message_echoes',
  'channel_status_update',
  'channel_health_update',
  'message_template_status_update'
];
// Erro do envio -> status HTTP para a tela
const STATUS_ENVIO = {
  whatsapp_desconectado: 409,
  fora_da_janela: 409,
  limite: 429,
  falha_oficial: 502,
  falha_envio: 502
};

const MIME_ANEXO = new Set([
  'application/pdf',
  'image/jpeg',
  'image/png',
  'image/webp',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
]);

function validarAnexo(file) {
  if (
    !file ||
    !MIME_ANEXO.has(file.mime) ||
    typeof file.nome !== 'string' ||
    typeof file.dados !== 'string' ||
    file.dados.length > 6990508 ||
    !/^[A-Za-z0-9+/]+={0,2}$/.test(file.dados) ||
    file.dados.length % 4 !== 0
  )
    return null;
  const bytes =
    (file.dados.length / 4) * 3 - (file.dados.endsWith('==') ? 2 : file.dados.endsWith('=') ? 1 : 0);
  // tira caracteres de controle e barras do nome do arquivo
  const nome = Array.from(file.nome, c =>
    c.charCodeAt(0) < 32 || c.charCodeAt(0) === 127 || c === '/' || c === '\\' ? ' ' : c
  )
    .join('')
    .trim()
    .slice(0, 120);
  return bytes <= 5242880 && nome ? { ...file, nome } : null;
}

function json(body, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      'Content-Type': 'application/json',
      'Cache-Control': 'no-store',
      'Access-Control-Allow-Origin': origem,
      Vary: 'Origin'
    }
  });
}

export function createHandler(d) {
  const log = d.log || (() => {});

  async function estadoIa(tenant) {
    const r = await d.iaLer(tenant);
    const propria = !!(r && r.chave);
    return {
      configurada: propria || !!d.chavePlataforma,
      propria,
      plataforma_disponivel: !!d.chavePlataforma,
      final: propria ? String(r.chave).slice(-4) : null,
      modelo: (r && r.modelo) || PREFERIDOS[0],
      teste_ok: r ? r.teste_ok : null,
      testado_em: r ? r.testado_em : null
    };
  }

  async function estadoWa(tenant, agora) {
    const w = await d.waLer(tenant);
    const servidor = !!(d.evolution && d.evolution.configurado);
    if (!w) return { servidor_configurado: servidor, estado: 'nao_criado' };
    const uso = await d.waUso(tenant);
    const frio = avaliar({ uso, tipo: 'campanha', agora });
    const resp = avaliar({ uso, tipo: 'resposta', agora });
    const fase = faseAquecimento(w.primeira_conexao_em, agora);
    const pausado = w.pausado_ate && new Date(w.pausado_ate).getTime() > agora;
    return {
      servidor_configurado: servidor,
      estado: w.estado,
      numero: w.numero || null,
      perfil_nome: w.perfil_nome || null,
      criar_leads: w.criar_leads !== false,
      conectado_em: w.conectado_em || null,
      pausado_ate: pausado ? w.pausado_ate : null,
      pausa_motivo: pausado ? MOTIVO_TEXTO[w.pausa_motivo] || w.pausa_motivo : null,
      aquecimento: { dias: fase.dias, rotulo: fase.rotulo, por_dia: fase.porDia, por_hora: fase.porHora },
      uso: {
        hoje: frio.contas.dia,
        hora: frio.contas.hora,
        frio_hoje: frio.contas.dia_frio,
        frio_hora: frio.contas.hora_frio,
        falhas_hora: frio.contas.falhas_hora,
        teto_dia: TETOS.porDia,
        teto_hora: TETOS.porHora
      },
      disparo: {
        pode: frio.pode,
        motivo: frio.motivo ? MOTIVO_TEXTO[frio.motivo] || frio.motivo : null,
        volta_em: frio.esperarAte
      },
      resposta: { pode: resp.pode, volta_em: resp.esperarAte },
      alerta: frio.alerta
    };
  }

  // Lê o estado na Evolution e grava no banco (o aviso também atualiza; isto
  // cobre o aviso que se perdeu).
  async function conferirWa(tenant) {
    const w = await d.waLer(tenant);
    if (!w || !d.evolution.configurado) return;
    try {
      const estado = await d.evolution.estado(w.instancia);
      let p = { numero: null, nome: null };
      if (estado === 'conectado') p = await d.evolution.perfil(w.instancia).catch(() => p);
      if (estado !== w.estado || (p.numero && p.numero !== w.numero))
        await d.waEstado(
          tenant,
          estado === 'desconectado' && w.estado === 'aguardando_qr' ? 'aguardando_qr' : estado,
          p.numero,
          p.nome
        );
    } catch (e) {
      if (e instanceof ErroEvolution && e.motivo === 'instancia_nao_encontrada')
        await d.waEstado(tenant, 'desconectado');
      else log(`conectores: conferir ${e instanceof ErroEvolution ? e.motivo : 'erro'}`);
    }
  }

  // ── WhatsApp oficial (Coexy) ──
  const coexyOk = () => !!(d.coexy && d.coexy.configurado);

  async function estadoOficial(tenant) {
    const o = d.oficialLer ? await d.oficialLer(tenant) : null;
    if (!o) return { configurado: coexyOk(), estado: 'nao_criado' };
    return {
      configurado: coexyOk(),
      estado: o.status,
      numero: o.numero || null,
      saude: o.saude || null,
      saude_motivo: o.saude_motivo || null,
      qualidade: o.qualidade || null,
      limite: o.limite || null,
      conectado_em: o.conectado_em || null,
      // o link de conexão só serve para conectar: não leva o token do canal
      connect_url: o.status === 'active' ? null : o.connect_url || null,
      reserva_auto: o.reserva_auto !== false,
      criar_leads: o.criar_leads !== false,
      modelos: !!o.waba_id
    };
  }

  // Lê o canal na Coexy e grava no banco (o aviso channel_status_update também
  // atualiza; isto cobre o aviso que se perdeu).
  async function conferirOficial(tenant) {
    const o = await d.oficialLer(tenant);
    if (!o || !coexyOk()) return;
    try {
      const c = await d.coexy.canal(o.channel_id);
      await d.oficialEvento(o.channel_id, c.status, c.phone_number_id, c.waba_id, c.numero);
      await d.oficialSaude(o.channel_id, c.saude, c.saude_motivo, c.qualidade, c.limite);
      const patch = {};
      if (c.connect_url && c.connect_url !== o.connect_url) patch.connect_url = c.connect_url;
      if (c.channel_token && c.channel_token !== o.channel_token) patch.channel_token = c.channel_token;
      if (Object.keys(patch).length) await d.oficialAtualizar(tenant, patch);
    } catch (e) {
      if (e instanceof ErroCoexy && e.motivo === 'nao_encontrado') {
        await d.oficialEvento(o.channel_id, 'disconnected');
        return 'nao_encontrado';
      }
      log(`conectores: conferir oficial ${e instanceof ErroCoexy ? e.motivo : 'erro'}`);
    }
  }

  // Um webhook da plataforma na Coexy, criado na primeira conexão. O segredo
  // HMAC vem só na criação: vai direto para o banco, nunca para a tela.
  async function garantirWebhook() {
    const url = d.coexyWebhookUrl;
    const atual = await d.coexyWebhookLer();
    if (atual && atual.webhook_id && atual.hmac_secret && atual.url === url) return;
    const lista = await d.coexy.webhooks();
    // um webhook nosso sem o segredo guardado não serve: troca por um novo
    for (const w of lista) if (w.url === url) await d.coexy.apagarWebhook(w.id);
    const novo = await d.coexy.criarWebhook(url, EVENTOS_COEXY);
    await d.coexyWebhookSalvar({ webhook_id: novo.id, url, hmac_secret: novo.hmac_secret });
  }

  async function modelosDo(tenant) {
    const o = await d.oficialLer(tenant);
    if (!o || o.status !== 'active' || !o.waba_id || !coexyOk()) return null;
    return { o, lista: await d.coexy.modelos(o.waba_id, o.channel_token) };
  }

  // Envio pela rota (oficial ou reserva) e registro na conversa.
  async function enviarPelaRota(tenant, alvo, p, corpoRegistro) {
    const tipo = alvo.lead_escreveu_24h ? 'resposta' : 'iniciado';
    const [oficial, conexao] = await Promise.all([
      d.oficialLer ? d.oficialLer(tenant) : null,
      d.waLer(tenant)
    ]);
    const r = await enviarWhatsapp(
      {
        coexy: d.coexy,
        evolution: d.evolution,
        oficial,
        conexao,
        uso: () => d.waUso(tenant),
        pausar: (ate, motivo) => d.waPausar(tenant, ate, motivo),
        falha: canal => d.registrarFalha(tenant, tipo, alvo.atendimento_id, canal),
        log
      },
      {
        ...p,
        numero: alvo.telefone,
        tipo,
        janela: !!alvo.lead_escreveu_24h,
        agora: d.now ? d.now() : Date.now(),
        atraso: tipo === 'resposta' ? 1200 : 2500
      }
    );
    const reg = await d.registrarEnvio(
      tenant,
      alvo.atendimento_id,
      corpoRegistro,
      alvo.autor,
      r.id,
      tipo,
      r.canal
    );
    return {
      ok: true,
      id: reg && reg.id ? reg.id : null,
      alerta: r.alerta,
      tipo,
      canal: r.canal,
      reserva: r.reserva
    };
  }

  function respostaErroEnvio(e) {
    if (!(e instanceof ErroEnvio)) throw e;
    const x = e.extra || {};
    return json(
      {
        error: e.codigo,
        ...(x.motivo ? { motivo: String(x.motivo) } : {}),
        ...(x.volta_em ? { volta_em: x.volta_em } : {})
      },
      STATUS_ENVIO[e.codigo] || 502
    );
  }

  async function testarIa(tenant) {
    const r = await d.iaLer(tenant);
    const chave = (r && r.chave) || d.chavePlataforma;
    if (!chave) return { ok: false, erro: 'sem_chave' };
    let modelos;
    try {
      modelos = await d.openaiModelos(chave);
    } catch (e) {
      await d.iaMarcarTeste(tenant, false);
      return {
        ok: false,
        erro: e && e.message === 'chave_recusada' ? 'chave_recusada' : 'openai_indisponivel'
      };
    }
    const chat = modelos
      .filter(
        m =>
          /^(gpt-|o\d|chatgpt-)/.test(m) && !/(audio|realtime|transcribe|tts|image|search|embedding)/.test(m)
      )
      .sort();
    await d.iaMarcarTeste(tenant, true);
    const atual = (r && r.modelo) || null;
    const sugerido =
      atual && chat.includes(atual) ? atual : PREFERIDOS.find(m => chat.includes(m)) || chat[0] || null;
    return { ok: true, modelos: chat.slice(0, 80), sugerido };
  }

  return async req => {
    if (req.headers.get('origin') !== origem) return json({ error: 'origin' }, 403);
    if (req.method === 'OPTIONS')
      return new Response(null, {
        status: 204,
        headers: {
          'Access-Control-Allow-Origin': origem,
          'Access-Control-Allow-Methods': 'POST, OPTIONS',
          'Access-Control-Allow-Headers': 'content-type, apikey, authorization, x-session-token',
          Vary: 'Origin'
        }
      });
    if (req.method !== 'POST') return json({ error: 'method' }, 405);
    const token = req.headers.get('x-session-token') || '';
    if (!token || token.length > 512) return json({ error: 'unauthorized' }, 401);
    let acao = '';
    try {
      const user = await d.context(token);
      if (!user || !/^[a-z0-9-]{1,50}$/.test(user.slug || '')) return json({ error: 'unauthorized' }, 403);
      let body;
      try {
        body = await req.json();
      } catch {
        return json({ error: 'invalid_request' }, 400);
      }
      acao = typeof body?.action === 'string' ? body.action.slice(0, 20) : '';
      const agora = d.now ? d.now() : Date.now();
      const tenant = user.tenant_id;

      // ── Envio pela Central: gestor ou corretor dono da conversa ──
      if (acao === 'wa_enviar' || acao === 'wa_anexo' || acao === 'wa_modelo') {
        const anexo = acao === 'wa_anexo' ? validarAnexo(body.anexo) : null;
        if (acao === 'wa_anexo' && !anexo) return json({ error: 'anexo_invalido' }, 400);
        const texto = typeof body.texto === 'string' ? body.texto.trim() : '';
        const m = acao === 'wa_modelo' && body.modelo && typeof body.modelo === 'object' ? body.modelo : null;
        const params = Array.isArray(body.parametros) ? body.parametros : [];
        if (
          !UUID.test(String(body.atendimento_id || '')) ||
          (acao === 'wa_modelo'
            ? !m ||
              !NOME_MODELO.test(String(m.nome || '')) ||
              !IDIOMA.test(String(m.idioma || '')) ||
              params.length > 20 ||
              !params.every(
                v => typeof v === 'string' && v.trim() && v.length <= 300 && !/[\n\t]| {5}/.test(v)
              )
            : (!anexo && !texto) || texto.length > (anexo ? 900 : 4000))
        )
          return json({ error: 'invalid_request' }, 400);
        let alvo;
        try {
          alvo = await d.alvo(token, body.atendimento_id);
        } catch (e) {
          const mm =
            /(sem_permissao|conversa_encerrada|conversa_nao_encontrada|sem_telefone|modulo_desabilitado)/.exec(
              String(e && e.message)
            );
          return json({ error: mm ? mm[1] : 'sem_permissao' }, mm && mm[1] === 'sem_telefone' ? 409 : 403);
        }
        if (!alvo || alvo.tenant_id !== tenant) return json({ error: 'sem_permissao' }, 403);
        try {
          if (acao === 'wa_modelo') {
            const ml = await modelosDo(tenant);
            if (!ml) return json({ error: 'oficial_desconectado' }, 409);
            const t = ml.lista.find(x => x.nome === m.nome && x.idioma === m.idioma);
            if (!t || t.status !== 'APPROVED' || !t.suportado)
              return json({ error: 'modelo_indisponivel' }, 409);
            if (params.length !== t.variaveis) return json({ error: 'invalid_request' }, 400);
            const valores = params.map(v => v.trim());
            const corpo = [t.cabecalho, preencher(t.corpo, valores), t.rodape].filter(Boolean).join('\n');
            return json(
              await enviarPelaRota(
                tenant,
                alvo,
                { modelo: { nome: t.nome, idioma: t.idioma, parametros: valores, texto: corpo } },
                corpo
              )
            );
          }
          return json(
            await enviarPelaRota(
              tenant,
              alvo,
              { texto, anexo },
              anexo ? [`📎 ${anexo.nome}`, texto].filter(Boolean).join('\n') : texto
            )
          );
        } catch (e) {
          if (e instanceof ErroCoexy) {
            log(`conectores: modelos ${e.motivo}`);
            return json({ error: 'temporarily_unavailable' }, 503);
          }
          return respostaErroEnvio(e);
        }
      }

      // Modelos aprovados (a Central lista para mandar fora da janela de 24 h)
      if (acao === 'wa_modelos') {
        let ml;
        try {
          ml = await modelosDo(tenant);
        } catch (e) {
          log(`conectores: modelos ${e instanceof ErroCoexy ? e.motivo : 'erro'}`);
          return json({ error: 'temporarily_unavailable' }, 503);
        }
        if (!ml) return json({ ok: true, modelos: [] });
        const lista = user.gestor ? ml.lista : ml.lista.filter(x => x.status === 'APPROVED' && x.suportado);
        return json({ ok: true, modelos: lista.slice(0, 250) });
      }

      // ── Daqui para baixo, só o gestor ──
      if (!user.gestor) return json({ error: 'forbidden' }, 403);

      if (acao === 'status') {
        if (body.conferir === true) await Promise.all([conferirWa(tenant), conferirOficial(tenant)]);
        return json({
          ia: await estadoIa(tenant),
          whatsapp: await estadoWa(tenant, agora),
          oficial: await estadoOficial(tenant)
        });
      }

      if (acao === 'oficial_conectar') {
        if (!coexyOk()) return json({ error: 'coexy_nao_configurado' }, 409);
        try {
          await garantirWebhook();
          let o = await d.oficialLer(tenant);
          // canal apagado na Coexy: cria outro no lugar
          if (o && (await conferirOficial(tenant)) === 'nao_encontrado') {
            await d.oficialApagar(tenant);
            o = null;
          }
          if (!o) {
            const c = await d.coexy.criarCanal(`SIIMOB ${user.slug}`);
            if (!c.id || !c.channel_token) return json({ error: 'temporarily_unavailable' }, 502);
            await d.oficialCriar({
              tenant_id: tenant,
              channel_id: c.id,
              status: c.status,
              channel_token: c.channel_token,
              connect_url: c.connect_url,
              criado_por: user.user_id
            });
          }
        } catch (e) {
          log(`conectores: oficial conectar ${e instanceof ErroCoexy ? `${e.motivo} ${e.status}` : 'erro'}`);
          const motivo = e instanceof ErroCoexy ? e.motivo : 'temporarily_unavailable';
          return json(
            {
              error: ['limite_canais', 'chave_coexy', 'assinatura_coexy'].includes(motivo)
                ? motivo
                : 'temporarily_unavailable'
            },
            502
          );
        }
        return json({ ok: true, oficial: await estadoOficial(tenant) });
      }

      if (acao === 'oficial_remover') {
        const o = await d.oficialLer(tenant);
        if (!o) return json({ error: 'not_connected' }, 409);
        try {
          if (coexyOk()) await d.coexy.apagarCanal(o.channel_id);
        } catch (e) {
          log(`conectores: oficial remover ${e instanceof ErroCoexy ? e.motivo : 'erro'}`);
          return json({ error: 'temporarily_unavailable' }, 502);
        }
        await d.oficialApagar(tenant);
        return json({ ok: true, oficial: await estadoOficial(tenant) });
      }

      if (acao === 'oficial_opcoes') {
        const patch = {};
        if (typeof body.reserva_auto === 'boolean') patch.reserva_auto = body.reserva_auto;
        if (typeof body.criar_leads === 'boolean') patch.criar_leads = body.criar_leads;
        if (!Object.keys(patch).length) return json({ error: 'invalid_request' }, 400);
        if (!(await d.oficialLer(tenant))) return json({ error: 'not_connected' }, 409);
        await d.oficialAtualizar(tenant, patch);
        // "criar leads" vale para os dois canais (a mensagem pela reserva também cria)
        if ('criar_leads' in patch && (await d.waLer(tenant))) await d.waOpcoes(tenant, patch.criar_leads);
        return json({ ok: true, oficial: await estadoOficial(tenant) });
      }

      if (acao === 'modelo_criar') {
        const nome = String(body.nome || '').trim();
        const categoria = String(body.categoria || '');
        const idioma = String(body.idioma || 'pt_BR');
        const corpo = typeof body.corpo === 'string' ? body.corpo.trim() : '';
        const rodape = typeof body.rodape === 'string' ? body.rodape.trim() : '';
        const exemplos = Array.isArray(body.exemplos) ? body.exemplos.map(v => String(v).trim()) : [];
        const vars = variaveis(corpo);
        if (
          !NOME_MODELO.test(nome) ||
          !['MARKETING', 'UTILITY'].includes(categoria) ||
          !IDIOMA.test(idioma) ||
          !corpo ||
          corpo.length > 1024 ||
          rodape.length > 60 ||
          !vars.every((n, i) => n === i + 1) ||
          exemplos.length !== vars.length ||
          !exemplos.every(v => v && v.length <= 200)
        )
          return json({ error: 'invalid_request' }, 400);
        const o = await d.oficialLer(tenant);
        if (!o || o.status !== 'active' || !o.waba_id || !coexyOk())
          return json({ error: 'oficial_desconectado' }, 409);
        try {
          const r = await d.coexy.criarModelo(o.waba_id, o.channel_token, {
            nome,
            categoria,
            idioma,
            corpo,
            exemplos,
            rodape
          });
          return json({ ok: true, status: r.status });
        } catch (e) {
          if (!(e instanceof ErroCoexy)) throw e;
          log(`conectores: criar modelo ${e.motivo}`);
          return json({ error: 'modelo_recusado', motivo: e.detalhe || null }, 422);
        }
      }

      if (acao === 'modelo_apagar') {
        const nome = String(body.nome || '');
        if (!NOME_MODELO.test(nome)) return json({ error: 'invalid_request' }, 400);
        const o = await d.oficialLer(tenant);
        if (!o || o.status !== 'active' || !o.waba_id || !coexyOk())
          return json({ error: 'oficial_desconectado' }, 409);
        try {
          await d.coexy.apagarModelo(o.waba_id, o.channel_token, nome);
        } catch (e) {
          if (!(e instanceof ErroCoexy)) throw e;
          log(`conectores: apagar modelo ${e.motivo}`);
          return json({ error: 'modelo_recusado', motivo: e.detalhe || null }, 422);
        }
        return json({ ok: true });
      }

      if (acao === 'ia_salvar') {
        const modelo = body.modelo == null ? null : String(body.modelo);
        if (modelo !== null && !MODELO.test(modelo)) return json({ error: 'invalid_request' }, 400);
        if (
          body.chave !== undefined &&
          body.chave !== null &&
          (typeof body.chave !== 'string' || !CHAVE_OPENAI.test(body.chave.trim()))
        )
          return json({ error: 'chave_invalida' }, 400);
        const atual = await d.iaLer(tenant);
        const chave =
          body.chave === undefined
            ? (atual && atual.chave) || null
            : body.chave === null
              ? null
              : body.chave.trim();
        if (!chave && !d.chavePlataforma) return json({ error: 'sem_chave' }, 400);
        if (body.chave) {
          // chave nova: testa antes de guardar, para não salvar chave errada
          try {
            await d.openaiModelos(chave);
          } catch (e) {
            return json(
              { error: e && e.message === 'chave_recusada' ? 'chave_recusada' : 'openai_indisponivel' },
              400
            );
          }
        }
        await d.iaSalvar(tenant, {
          chave,
          modelo: modelo || (atual && atual.modelo) || PREFERIDOS[0],
          user: user.user_id,
          teste_ok: body.chave ? true : atual ? atual.teste_ok : null
        });
        return json({ ok: true, ia: await estadoIa(tenant) });
      }

      if (acao === 'ia_testar') return json({ ...(await testarIa(tenant)), ia: await estadoIa(tenant) });

      if (acao === 'wa_conectar') {
        if (!d.evolution.configurado) return json({ error: 'servidor_nao_configurado' }, 409);
        const w = await d.waLer(tenant);
        const segredo = d.gerarToken();
        const hash = await d.hash(segredo);
        const instancia = w ? w.instancia : `siimob-${user.slug}`.slice(0, 60);
        const url = d.webhookUrl(instancia, segredo);
        let qr;
        try {
          if (!w) {
            await d.waCriar({
              tenant_id: tenant,
              instancia,
              webhook_token_hash: hash,
              criado_por: user.user_id
            });
            qr = await d.evolution.criar(instancia, url);
          } else {
            await d.waToken(tenant, hash);
            try {
              await d.evolution.definirWebhook(instancia, url);
              qr = await d.evolution.qr(instancia);
            } catch (e) {
              if (!(e instanceof ErroEvolution) || e.motivo !== 'instancia_nao_encontrada') throw e;
              qr = await d.evolution.criar(instancia, url);
            }
          }
        } catch (e) {
          log(`conectores: conectar ${e instanceof ErroEvolution ? `${e.motivo} ${e.status}` : 'erro'}`);
          return json({ error: e instanceof ErroEvolution ? e.motivo : 'temporarily_unavailable' }, 502);
        }
        await d.waEstado(tenant, 'aguardando_qr');
        return json({ ok: true, qr: qr.qr, codigo: qr.codigo, whatsapp: await estadoWa(tenant, agora) });
      }

      if (acao === 'wa_desconectar') {
        const w = await d.waLer(tenant);
        if (!w) return json({ error: 'not_connected' }, 409);
        try {
          if (d.evolution.configurado) await d.evolution.sair(w.instancia);
        } catch (e) {
          log(`conectores: desconectar ${e instanceof ErroEvolution ? e.motivo : 'erro'}`);
          return json({ error: 'temporarily_unavailable' }, 502);
        }
        await d.waEstado(tenant, 'desconectado');
        return json({ ok: true, whatsapp: await estadoWa(tenant, agora) });
      }

      if (acao === 'wa_opcoes') {
        if (typeof body.criar_leads !== 'boolean') return json({ error: 'invalid_request' }, 400);
        if (!(await d.waLer(tenant))) return json({ error: 'not_connected' }, 409);
        await d.waOpcoes(tenant, body.criar_leads);
        if (d.oficialLer && (await d.oficialLer(tenant)))
          await d.oficialAtualizar(tenant, { criar_leads: body.criar_leads });
        return json({ ok: true, whatsapp: await estadoWa(tenant, agora) });
      }

      return json({ error: 'invalid_request' }, 400);
    } catch (e) {
      log(`conectores: ${acao || '?'} falhou (${e instanceof ErroEvolution ? e.motivo : 'erro interno'})`);
      return json({ error: 'temporarily_unavailable' }, 503);
    }
  };
}
