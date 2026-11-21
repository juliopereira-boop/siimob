// ─── Do aviso da Meta ao lead no funil ───────────────────────────────────────
//
// O webhook só recebe identificadores (página, formulário, lead). Para cada
// aviso, este processador:
//   1. descobre a empresa dona da página (siimob_meta_pages);
//   2. confere se o formulário está marcado para gerar lead (siimob_meta_forms)
//      e para qual funil ele vai;
//   3. pega o token da página com o token da conexão da empresa e busca o lead
//      na Graph API (nome, telefone, e-mail e as outras respostas);
//   4. chama a1_integracao_criar_lead, que põe o lead na etapa de INÍCIO do
//      funil e não duplica;
//   5. devolve o resultado para ser gravado no próprio aviso.
//
// JavaScript puro, sem Deno: banco e Graph chegam injetados, para os testes em
// Node (testes/meta/meta-processa.test.mjs). O index.ts liga as peças reais.

const GRAPH = 'https://graph.facebook.com/v27.0';
const CAMPOS_COMPLETOS = 'created_time,field_data,form_id,ad_id,ad_name,adset_name,campaign_id,campaign_name,is_organic,platform';
const CAMPOS_BASICOS = 'created_time,field_data,form_id,is_organic,platform';

/** Erro da Graph já traduzido para o motivo que a tela mostra. */
export class ErroMeta extends Error {
  constructor(motivo, codigo) {
    super(motivo);
    this.motivo = motivo;
    this.codigo = codigo;
  }
}

/** Classifica a resposta de erro da Graph API. */
export function motivoDoErro(corpo) {
  const e = (corpo && corpo.error) || {};
  if (e.code === 190) return 'reconectar';
  if ([3, 10, 200, 230, 294, 299].includes(e.code) || (e.code >= 200 && e.code < 300)) return 'permissao_meta';
  if (e.code === 100) return 'campo_ou_id_invalido';
  return 'meta_indisponivel';
}

/** GET na Graph com tempo limite. Token no cabeçalho, nunca na URL. */
export function criarGraph(fetcher = fetch) {
  async function get(caminho, params, token) {
    const url = new URL(`${GRAPH}/${caminho}`);
    for (const [k, v] of Object.entries(params || {})) url.searchParams.set(k, v);
    let r;
    try {
      r = await fetcher(url, {
        headers: { Authorization: `Bearer ${token}`, Accept: 'application/json' },
        redirect: 'error',
        signal: AbortSignal.timeout(8000)
      });
    } catch {
      throw new ErroMeta('meta_indisponivel');
    }
    const corpo = await r.json().catch(() => ({}));
    if (!r.ok || corpo.error) throw new ErroMeta(motivoDoErro(corpo), corpo?.error?.code);
    return corpo;
  }
  return {
    async tokenDaPagina(tokenUsuario, pageId) {
      const p = await get(pageId, { fields: 'access_token' }, tokenUsuario);
      if (typeof p.access_token !== 'string' || !p.access_token) throw new ErroMeta('permissao_meta');
      return p.access_token;
    },
    /** Os leads mais recentes de um formulário (só id e data). */
    async leadsDoFormulario(formId, tokenPagina) {
      const d = await get(`${formId}/leads`, { fields: 'id,created_time', limit: '25' }, tokenPagina);
      return Array.isArray(d.data) ? d.data : [];
    },
    /** Os formulários de uma página (para "todos os formulários"). */
    async formulariosDaPagina(pageId, tokenPagina) {
      const d = await get(`${pageId}/leadgen_forms`, { fields: 'id', limit: '100' }, tokenPagina);
      return Array.isArray(d.data) ? d.data : [];
    },
    async lead(leadgenId, tokenPagina) {
      // Os campos de anúncio e campanha podem exigir permissão de anúncios. Sem
      // ela, a Meta recusa o pedido inteiro: tenta de novo só com o formulário.
      try {
        return await get(leadgenId, { fields: CAMPOS_COMPLETOS }, tokenPagina);
      } catch (e) {
        if (!(e instanceof ErroMeta) || !['permissao_meta', 'campo_ou_id_invalido'].includes(e.motivo)) throw e;
        return await get(leadgenId, { fields: CAMPOS_BASICOS }, tokenPagina);
      }
    }
  };
}

const semAcento = s =>
  String(s || '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '');

const CHAVES_NOME = ['full_name', 'nome_completo', 'nome', 'name', 'seu_nome', 'qual_seu_nome', 'qual_e_o_seu_nome'];
const CHAVES_TEL = ['phone_number', 'phone', 'telefone', 'celular', 'whatsapp', 'qual_seu_whatsapp', 'seu_whatsapp', 'numero_de_telefone', 'telefone_whatsapp'];
const CHAVES_EMAIL = ['email', 'e_mail', 'seu_email', 'qual_seu_email', 'work_email'];

/** Separa nome, telefone e e-mail das outras respostas do formulário. */
export function mapearCampos(fieldData) {
  const lista = Array.isArray(fieldData) ? fieldData : [];
  const valores = {};
  const respostas = [];
  for (const f of lista) {
    if (!f || typeof f.name !== 'string') continue;
    const chave = semAcento(f.name);
    const valor = (Array.isArray(f.values) ? f.values : [])
      .map(v => String(v ?? '').trim())
      .filter(Boolean)
      .join(', ')
      .slice(0, 500);
    if (!valor) continue;
    valores[chave] = valor;
    if (![...CHAVES_NOME, ...CHAVES_TEL, ...CHAVES_EMAIL, 'first_name', 'last_name'].includes(chave))
      respostas.push({ pergunta: f.name.replace(/_/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 200), resposta: valor });
  }
  const primeiro = k => k.map(c => valores[c]).find(Boolean) || '';
  const nome = primeiro(CHAVES_NOME) || [valores.first_name, valores.last_name].filter(Boolean).join(' ');
  return { nome, telefone: primeiro(CHAVES_TEL), email: primeiro(CHAVES_EMAIL), respostas };
}

/** O texto que vai em Observações do lead. */
export function montarObservacoes({ formulario, lead, respostas }) {
  const linhas = [`Lead recebido pela Meta (Facebook/Instagram).`, `Formulário: ${formulario}`];
  if (lead.campaign_name) linhas.push(`Campanha: ${lead.campaign_name}`);
  if (lead.adset_name) linhas.push(`Conjunto: ${lead.adset_name}`);
  if (lead.ad_name) linhas.push(`Anúncio: ${lead.ad_name}`);
  if (lead.is_organic === true) linhas.push('Origem orgânica (sem anúncio pago).');
  if (respostas.length) {
    linhas.push('', 'Respostas do formulário:');
    for (const r of respostas) linhas.push(`• ${r.pergunta}: ${r.resposta}`);
  }
  return linhas.join('\n').slice(0, 4000);
}

/**
 * @param {{db: object, graph: object, now?: () => number}} deps
 *   db.pagina(pageId) -> {tenant_id} | null
 *   db.formulario(tenantId, pageId, formId) -> {selected, funil, form_name} | null
 *   db.conexao(tenantId) -> {access_token, token_expires_at, data_access_expires_at} | null
 *   db.criarLead(args) -> resposta de a1_integracao_criar_lead
 */
export function criarProcessador({ db, graph, now = () => Date.now() }) {
  return async function processar(ev) {
    const pagina = await db.pagina(ev.page_id);
    if (!pagina) return { status: 'ignorado', detalhe: 'pagina_sem_empresa' };
    const tenant = pagina.tenant_id;
    // Formulário marcado entra no funil escolhido. Com "todos os formulários"
    // ligado na página, qualquer outro (inclusive um criado depois) também
    // entra, no primeiro funil.
    const linha = await db.formulario(tenant, ev.page_id, ev.form_id);
    const marcado = !!linha && linha.selected === true;
    if (!marcado && pagina.todos_formularios !== true) return { tenant_id: tenant, status: 'ignorado', detalhe: 'formulario_nao_marcado' };
    const form = { form_name: linha?.form_name || null, funil: marcado ? linha.funil || null : null };
    const conexao = await db.conexao(tenant);
    if (!conexao || !conexao.access_token) return { tenant_id: tenant, status: 'erro', detalhe: 'sem_conexao' };
    // Pausada pela empresa: o aviso fica guardado e pode entrar ao reativar.
    if (conexao.ativo === false) return { tenant_id: tenant, status: 'ignorado', detalhe: 'integracao_inativa' };
    const venceu = [conexao.token_expires_at, conexao.data_access_expires_at].some(d => d && new Date(d).getTime() <= now());
    if (venceu) return { tenant_id: tenant, status: 'erro', detalhe: 'reconectar' };

    let lead;
    try {
      const tokenPagina = await graph.tokenDaPagina(conexao.access_token, ev.page_id);
      lead = await graph.lead(ev.leadgen_id, tokenPagina);
    } catch (e) {
      return { tenant_id: tenant, status: 'erro', detalhe: e instanceof ErroMeta ? e.motivo : 'meta_indisponivel' };
    }
    const campos = mapearCampos(lead.field_data);
    const formulario = form.form_name || `Formulário ${ev.form_id}`;
    const rotulo = `Meta · ${lead.campaign_name || formulario}`.slice(0, 120);
    const r = await db.criarLead({
      p_tenant: tenant,
      p_origem: 'meta',
      p_externo: ev.leadgen_id,
      p_funil: form.funil || null,
      p_nome: campos.nome,
      p_telefone: campos.telefone,
      p_email: campos.email,
      p_detalhes: {
        rotulo,
        observacoes: montarObservacoes({ formulario, lead, respostas: campos.respostas }),
        evento: `Lead recebido da Meta · ${formulario}`.slice(0, 300),
        dados: {
          pagina: ev.page_id,
          formulario: ev.form_id,
          formulario_nome: formulario,
          campanha: lead.campaign_name || null,
          conjunto: lead.adset_name || null,
          anuncio: lead.ad_name || null,
          organico: lead.is_organic === true,
          plataforma: lead.platform || null,
          criado_na_meta: lead.created_time || null,
          respostas: campos.respostas
        }
      }
    });
    if (r && r.ok) return { tenant_id: tenant, status: r.duplicado ? 'duplicado' : 'criado', case_id: r.case_id || null };
    const erro = (r && r.erro) || 'falha_ao_criar';
    return { tenant_id: tenant, status: erro === 'sem_modulo_leads' ? 'ignorado' : 'erro', detalhe: erro };
  };
}

/**
 * Busca direta: em vez de esperar o aviso da Meta (webhook), pergunta à Graph
 * os leads recentes de cada formulário que a empresa marcou (ou de todos, com
 * "todos os formulários"). Devolve avisos no mesmo formato do webhook, para
 * entrarem pela mesma fila: o banco ignora os que já existem e o processador
 * não cria lead duplicado. Só leads dos últimos `dias` dias.
 *
 *   db.conexao(tenant), db.paginasDaEmpresa(tenant) -> [{page_id, todos_formularios}]
 *   db.formulariosMarcados(tenant) -> [{page_id, form_id}]
 */
export function criarSincronizador({ db, graph, now = () => Date.now(), dias = 7 }) {
  const ID = /^\d{1,32}$/;
  return async function sincronizar(tenant) {
    const conexao = await db.conexao(tenant);
    if (!conexao || !conexao.access_token) return { avisos: [], detalhe: 'sem_conexao' };
    if (conexao.ativo === false) return { avisos: [], detalhe: 'integracao_inativa' };
    const venceu = [conexao.token_expires_at, conexao.data_access_expires_at].some(d => d && new Date(d).getTime() <= now());
    if (venceu) return { avisos: [], detalhe: 'reconectar' };
    const paginas = (await db.paginasDaEmpresa(tenant)) || [];
    const marcados = (await db.formulariosMarcados(tenant)) || [];
    const desde = now() - dias * 86400000;
    const avisos = [];
    const falhas = [];
    for (const pg of paginas) {
      if (!ID.test(String(pg.page_id))) continue;
      let token;
      try {
        token = await graph.tokenDaPagina(conexao.access_token, pg.page_id);
      } catch (e) {
        falhas.push(`page=${pg.page_id}:${e instanceof ErroMeta ? e.motivo : 'meta_indisponivel'}`);
        continue;
      }
      let forms = marcados.filter(f => f.page_id === pg.page_id).map(f => String(f.form_id));
      if (pg.todos_formularios === true) {
        try {
          forms = [...new Set([...forms, ...(await graph.formulariosDaPagina(pg.page_id, token)).map(f => String(f.id))])];
        } catch (e) {
          falhas.push(`forms page=${pg.page_id}:${e instanceof ErroMeta ? e.motivo : 'meta_indisponivel'}`);
        }
      }
      for (const form of forms.filter(f => ID.test(f))) {
        try {
          for (const l of await graph.leadsDoFormulario(form, token)) {
            const quando = new Date(l.created_time || 0).getTime();
            if (!ID.test(String(l.id)) || !(quando >= desde)) continue;
            avisos.push({ page_id: String(pg.page_id), leadgen_id: String(l.id), form_id: form });
          }
        } catch (e) {
          falhas.push(`form=${form}:${e instanceof ErroMeta ? e.motivo : 'meta_indisponivel'}`);
        }
      }
    }
    return { avisos, falhas };
  };
}
