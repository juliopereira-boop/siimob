// ─── atendimento-conectores: OpenAI e WhatsApp (Evolution) da Central ────────
//
// Quem chama: a tela de Configurações › Integrações (gestor) e a Central de
// atendimento (gestor ou corretor dono da conversa, só para enviar).
// Tudo que é segredo (chave da OpenAI, chave da Evolution, token do aviso)
// fica aqui no servidor. A tela recebe só o estado e os 4 últimos caracteres
// da chave.
//
// Dependências injetadas: o handler não fala com banco nem com a rede direto,
// para os testes rodarem isolados (testes/conectores/*.test.mjs).
import { avaliar, faseAquecimento, MOTIVO_TEXTO, TETOS } from './limites.mjs';
import { ErroEvolution } from './evolution.mjs';

const origem = 'https://siimob.com';
const CHAVE_OPENAI = /^sk-[A-Za-z0-9_-]{16,250}$/;
const MODELO = /^[a-zA-Z0-9._:-]{2,60}$/;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
// Modelos preferidos, em ordem: o primeiro que a conta tiver vira o padrão.
const PREFERIDOS = ['gpt-4.1-mini', 'gpt-4o-mini', 'gpt-5-mini', 'gpt-4.1', 'gpt-4o'];

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
  const nome = file.nome
    .replace(/[\x00-\x1f\x7f/\\]/g, ' ')
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
      if (acao === 'wa_enviar' || acao === 'wa_anexo') {
        const anexo = acao === 'wa_anexo' ? validarAnexo(body.anexo) : null;
        if (acao === 'wa_anexo' && !anexo) return json({ error: 'anexo_invalido' }, 400);
        const texto = typeof body.texto === 'string' ? body.texto.trim() : '';
        if (
          !UUID.test(String(body.atendimento_id || '')) ||
          (!anexo && !texto) ||
          texto.length > (anexo ? 900 : 4000)
        )
          return json({ error: 'invalid_request' }, 400);
        let alvo;
        try {
          alvo = await d.alvo(token, body.atendimento_id);
        } catch (e) {
          const m =
            /(sem_permissao|conversa_encerrada|conversa_nao_encontrada|sem_telefone|modulo_desabilitado)/.exec(
              String(e && e.message)
            );
          return json({ error: m ? m[1] : 'sem_permissao' }, m && m[1] === 'sem_telefone' ? 409 : 403);
        }
        if (!alvo || alvo.tenant_id !== tenant) return json({ error: 'sem_permissao' }, 403);
        const w = await d.waLer(tenant);
        if (!w || w.estado !== 'conectado') return json({ error: 'whatsapp_desconectado' }, 409);
        const tipo = alvo.lead_escreveu_24h ? 'resposta' : 'iniciado';
        const lim = avaliar({ uso: await d.waUso(tenant), tipo, agora });
        if (!lim.pode) {
          if (lim.pausarGeral) await d.waPausar(tenant, lim.esperarAte, lim.motivo);
          log(`conectores: envio segurado (${lim.motivo})`);
          return json(
            { error: 'limite', motivo: MOTIVO_TEXTO[lim.motivo] || lim.motivo, volta_em: lim.esperarAte },
            429
          );
        }
        let enviado;
        try {
          enviado = anexo
            ? await d.evolution.enviarMidia(
                w.instancia,
                alvo.telefone,
                anexo.dados,
                anexo.mime,
                anexo.nome,
                texto
              )
            : await d.evolution.enviarTexto(
                w.instancia,
                alvo.telefone,
                texto,
                tipo === 'resposta' ? 1200 : 2500
              );
        } catch (e) {
          await d.registrarFalha(tenant, tipo, alvo.atendimento_id);
          log(`conectores: envio falhou (${e instanceof ErroEvolution ? e.motivo : 'erro'})`);
          return json({ error: 'falha_envio' }, 502);
        }
        const r = await d.registrarEnvio(
          tenant,
          alvo.atendimento_id,
          anexo ? [`📎 ${anexo.nome}`, texto].filter(Boolean).join('\n') : texto,
          alvo.autor,
          enviado.id,
          tipo
        );
        return json({ ok: true, id: r && r.id ? r.id : null, alerta: lim.alerta, tipo });
      }

      // ── Daqui para baixo, só o gestor ──
      if (!user.gestor) return json({ error: 'forbidden' }, 403);

      if (acao === 'status') {
        if (body.conferir === true) await conferirWa(tenant);
        return json({ ia: await estadoIa(tenant), whatsapp: await estadoWa(tenant, agora) });
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
        return json({ ok: true, whatsapp: await estadoWa(tenant, agora) });
      }

      return json({ error: 'invalid_request' }, 400);
    } catch (e) {
      log(`conectores: ${acao || '?'} falhou (${e instanceof ErroEvolution ? e.motivo : 'erro interno'})`);
      return json({ error: 'temporarily_unavailable' }, 503);
    }
  };
}
