// A Edge Function sa-proxy, testada em Node com um Supabase de mentira.
//
// O que importa aqui é o que ela NÃO deixa passar: pedido sem sessão, cabeçalho
// do navegador tentando trocar a chave, origem estranha no CORS, rota fora de
// /rest e /storage. A chave de serviço é a mestra do banco; a função é a única
// porta que a usa, então cada fresta dela vira fresta do banco inteiro.
const path = require('path');
const { pathToFileURL } = require('url');
const { checa, resumo } = require('./comum');

const CHAVE = 'chave-de-servico-teste';
const BASE = 'https://proj.supabase.co';
const TOKEN = 'a'.repeat(64);

(async () => {
  const { criarTratador } = await import(
    pathToFileURL(path.join(__dirname, '../supabase/functions/sa-proxy/nucleo.mjs')).href
  );

  /** Supabase de mentira: registra cada pedido e responde por rota. */
  const pedidos = [];
  let sessaoBoa = true;
  let respostaLogin = { ok: true, token: TOKEN, expira_em: '2099-01-01T00:00:00Z' };
  const supa = async (url, init = {}) => {
    const h = new Headers(init.headers || {});
    const corpo = init.body ? Buffer.from(init.body).toString() : '';
    pedidos.push({ url: String(url), metodo: init.method || 'GET', h, corpo });
    const u = new URL(url);
    const json = (d, s = 200, extra = {}) =>
      new Response(JSON.stringify(d), {
        status: s,
        headers: { 'content-type': 'application/json', ...extra }
      });
    if (u.pathname === '/rest/v1/rpc/a1_sa_totp_status') return json({ configurado: true });
    if (u.pathname === '/rest/v1/rpc/a1_sa_login') return json(respostaLogin);
    if (u.pathname === '/rest/v1/rpc/a1_sa_sessao_valida') return json(sessaoBoa);
    if (u.pathname === '/rest/v1/rpc/a1_sa_sair') return new Response(null, { status: 204 });
    if (u.pathname.startsWith('/rest/v1/a1_tenants'))
      return json([{ id: 't1' }], 200, { 'content-range': '0-0/1', 'set-cookie': 'x=1', 'x-segredo': 'nao' });
    if (u.pathname.startsWith('/storage/v1/object/site/')) return json({ Key: 'site/a.png' });
    return json({ message: 'nao_previsto' }, 404);
  };
  const tratar = criarTratador({ url: BASE + '/', chave: CHAVE, fetch: supa, cacheMs: 0 });
  const req = (caminho, init = {}) => tratar(new Request(`${BASE}/functions/v1/sa-proxy${caminho}`, init));
  const ultimo = () => pedidos[pedidos.length - 1];

  console.log('\nCORS');
  let r = await req('/status', { method: 'OPTIONS', headers: { origin: 'https://siimob.com.br' } });
  checa('pré-voo responde 204', r.status === 204);
  checa(
    'origem do SIIMOB é liberada',
    r.headers.get('access-control-allow-origin') === 'https://siimob.com.br'
  );
  checa(
    'o cabeçalho da sessão é aceito',
    /x-sa-sessao/.test(r.headers.get('access-control-allow-headers') || '')
  );
  r = await req('/status', { method: 'OPTIONS', headers: { origin: 'https://golpe.example' } });
  checa('origem estranha não recebe Allow-Origin', !r.headers.get('access-control-allow-origin'));
  const so = criarTratador({
    url: BASE,
    chave: CHAVE,
    fetch: supa,
    origens: 'https://a.test, https://b.test'
  });
  r = await so(
    new Request(`${BASE}/functions/v1/sa-proxy/status`, {
      method: 'OPTIONS',
      headers: { origin: 'https://b.test' }
    })
  );
  checa('SA_ORIGENS troca a lista', r.headers.get('access-control-allow-origin') === 'https://b.test');
  r = await so(
    new Request(`${BASE}/functions/v1/sa-proxy/status`, {
      method: 'OPTIONS',
      headers: { origin: 'https://siimob.com.br' }
    })
  );
  checa('com SA_ORIGENS a lista padrão sai', !r.headers.get('access-control-allow-origin'));

  console.log('\nSem configuração');
  r = await criarTratador({ url: '', chave: '', fetch: supa })(
    new Request(`${BASE}/functions/v1/sa-proxy/status`)
  );
  checa('sem URL ou chave responde 500 e não chama ninguém', r.status === 500);

  console.log('\nStatus e login');
  r = await req('/status');
  checa('status repassa o que o banco diz', r.status === 200 && (await r.json()).configurado === true);
  checa('e chama o banco com a chave de serviço', ultimo().h.get('authorization') === `Bearer ${CHAVE}`);

  r = await req('/login', {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      'x-forwarded-for': '200.1.2.3, 10.0.0.1',
      'user-agent': 'Teste'
    },
    body: JSON.stringify({ codigo: '123 456' })
  });
  let j = await r.json();
  checa('login certo devolve 200 com o token', r.status === 200 && j.token === TOKEN);
  const corpoLogin = JSON.parse(ultimo().corpo);
  checa('o código chega só com dígitos', corpoLogin.p_codigo === '123456', corpoLogin.p_codigo);
  checa('o IP é o primeiro do x-forwarded-for', corpoLogin.p_ip === '200.1.2.3', corpoLogin.p_ip);
  checa('o navegador vai junto, para o registro', corpoLogin.p_agente === 'Teste');

  for (const [erro, status] of [
    ['codigo_invalido', 401],
    ['bloqueado', 429],
    ['nao_configurado', 409]
  ]) {
    respostaLogin = { ok: false, erro };
    r = await req('/login', { method: 'POST', body: JSON.stringify({ codigo: '000000' }) });
    checa(`login com ${erro} responde ${status}`, r.status === status, String(r.status));
  }
  respostaLogin = { ok: false, erro: 'codigo_invalido' };
  r = await req('/login', { method: 'POST', body: 'isto não é json' });
  checa('corpo inválido não derruba a função', r.status === 401);

  console.log('\nRepasse ao banco');
  pedidos.length = 0;
  r = await req('/rest/v1/a1_tenants?limit=1', { headers: { origin: 'https://siimob.com.br' } });
  checa(
    'sem sessão: 401 sessao_invalida',
    r.status === 401 && (await r.json()).message === 'sessao_invalida'
  );
  checa('e o pedido nem chega ao banco', pedidos.length === 0);
  r = await req('/rest/v1/a1_tenants', { headers: { 'x-sa-sessao': 'curto' } });
  checa('token fora do formato nem é conferido no banco', r.status === 401 && pedidos.length === 0);

  sessaoBoa = false;
  r = await req('/rest/v1/a1_tenants', { headers: { 'x-sa-sessao': TOKEN } });
  checa('sessão que o banco recusa: 401', r.status === 401);
  sessaoBoa = true;

  pedidos.length = 0;
  r = await req('/rest/v1/a1_tenants?select=id&limit=1', {
    headers: {
      'x-sa-sessao': TOKEN,
      origin: 'https://siimob.com.br',
      authorization: 'Bearer chave-do-navegador',
      apikey: 'chave-do-navegador',
      prefer: 'count=exact',
      cookie: 'sessao=roubada',
      'x-forwarded-host': 'outro'
    }
  });
  const repasse = ultimo();
  checa(
    'com sessão, o pedido chega ao REST com a query',
    repasse.url === `${BASE}/rest/v1/a1_tenants?select=id&limit=1`,
    repasse.url
  );
  checa(
    'vai com a chave de serviço, não com a do navegador',
    repasse.h.get('authorization') === `Bearer ${CHAVE}` && repasse.h.get('apikey') === CHAVE
  );
  checa('Prefer passa', repasse.h.get('prefer') === 'count=exact');
  checa(
    'cookie e x-forwarded-host não passam',
    !repasse.h.get('cookie') && !repasse.h.get('x-forwarded-host')
  );
  checa('o token da sessão não vai ao banco', !repasse.h.get('x-sa-sessao'));
  checa('a resposta volta com status e corpo', r.status === 200 && (await r.json())[0].id === 't1');
  checa('content-range volta (contagem)', r.headers.get('content-range') === '0-0/1');
  checa(
    'set-cookie e cabeçalhos estranhos não voltam',
    !r.headers.get('set-cookie') && !r.headers.get('x-segredo')
  );
  checa('a resposta tem CORS', r.headers.get('access-control-allow-origin') === 'https://siimob.com.br');

  r = await req('/storage/v1/object/site/a.png', {
    method: 'POST',
    headers: { 'x-sa-sessao': TOKEN, 'content-type': 'image/png', 'x-upsert': 'true' },
    body: new Uint8Array([137, 80, 78, 71])
  });
  const up = ultimo();
  checa(
    'upload ao Storage é repassado com o corpo',
    up.metodo === 'POST' && up.corpo.length === 4 && r.status === 200
  );
  checa(
    'x-upsert e content-type passam',
    up.h.get('x-upsert') === 'true' && up.h.get('content-type') === 'image/png'
  );

  pedidos.length = 0;
  r = await req('/auth/v1/admin/users', { headers: { 'x-sa-sessao': TOKEN } });
  checa('rota fora de /rest e /storage: 404', r.status === 404 && pedidos.length === 0);
  r = await req('/rest/v2/qualquer', { headers: { 'x-sa-sessao': TOKEN } });
  checa('versão desconhecida do REST: 404', r.status === 404);

  console.log('\nSair');
  pedidos.length = 0;
  r = await req('/sair', { method: 'POST', headers: { 'x-sa-sessao': TOKEN } });
  checa('sair encerra a sessão no banco', r.status === 200 && /a1_sa_sair$/.test(ultimo().url));
  checa('e manda o token para o banco apagar', JSON.parse(ultimo().corpo).p_token === TOKEN);

  console.log('\nFalha do banco');
  const quebra = criarTratador({
    url: BASE,
    chave: CHAVE,
    fetch: async () => {
      throw new Error('rede caiu');
    }
  });
  r = await quebra(new Request(`${BASE}/functions/v1/sa-proxy/status`));
  j = await r.json();
  checa('rede caída responde 502 sem vazar a chave', r.status === 502 && !JSON.stringify(j).includes(CHAVE));

  console.log('\nSQL do autenticador');
  // O Supabase liga o pg_safeupdate nos pedidos da API: DELETE ou UPDATE sem
  // WHERE dentro de função chamada por RPC dá erro 21000. O Postgres das provas
  // não tem a extensão, então a regra é conferida no texto da migração.
  const sql = require('fs').readFileSync(
    path.join(__dirname, '../database/migrations/2026-11-12_superadmin_autenticador.sql'),
    'utf8'
  );
  const semWhere = sql
    .split(';')
    .map(c =>
      c
        .replace(/--[^\n]*/g, ' ')
        .replace(/\s+/g, ' ')
        .trim()
    )
    .filter(c => /^(delete from|update) /i.test(c) && !/ where /i.test(c));
  checa('nenhum DELETE/UPDATE sem WHERE (pg_safeupdate)', semWhere.length === 0, semWhere.join(' | '));

  process.exit(resumo([]) ? 1 : 0);
})().catch(e => {
  console.error(e);
  process.exit(1);
});
