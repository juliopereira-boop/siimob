// Superadmin › excluir cliente: uma chamada só ao banco, tudo ou nada.
//
// O RELATO: excluir um cliente dava 409 (Conflict) no DELETE de a1_users e de
// a1_tenants, e o DELETE das licenças (a1_tenant_modules), que ia em paralelo,
// passava: o cliente ficava pela metade, sem módulos.
//
// O que este arquivo prova: depois das duas confirmações, a tela chama
// rpc/a1_sa_excluir_cliente com o id do cliente e NÃO manda nenhum DELETE
// solto; nome digitado errado não chama nada; erro do banco avisa que nada foi
// apagado; e o nome do cliente não vira HTML.
const { chromium } = require('playwright');
const BASE = 'http://localhost:' + (process.env.PORTA_TESTE || 8099);

let ok = 0,
  bad = 0;
const checa = (n, v, x = '') => {
  v ? (ok++, console.log('  ✓ ' + n)) : (bad++, console.log('  ✗ ' + n + '  ' + x));
};
const NOME = 'VELLA <b>IMOB</b>';
const TENANTS = [
  {
    id: 'aaaaaaaa-0000-0000-0000-000000000001',
    name: NOME,
    slug: 'vella',
    status: 'active',
    plan_key: 'starter',
    max_users: 3,
    tipo_cliente: 'imobiliaria',
    email: 'a@x.com',
    created_at: '2026-01-01'
  }
];

async function abrir(resposta) {
  const b = await chromium.launch();
  const p = await b.newPage({ viewport: { width: 1500, height: 1000 } });
  const erros = [];
  const chamadas = [];
  p.on('pageerror', e => erros.push('JS: ' + e.message));
  await p.route(/fonts\.(googleapis|gstatic)\.com/, r =>
    r.fulfill({ status: 200, contentType: 'text/css', body: '' })
  );
  await p.route(/supabase\.co/, async r => {
    const u = r.request().url();
    const m = r.request().method();
    if (m !== 'GET') chamadas.push({ u, m, corpo: r.request().postData() });
    if (u.includes('rpc/a1_sa_excluir_cliente'))
      return r.fulfill({
        status: resposta.status,
        contentType: 'application/json',
        body: JSON.stringify(resposta.corpo)
      });
    if (u.includes('/a1_tenants') && m === 'GET')
      return r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(TENANTS) });
    return r.fulfill({ status: 200, contentType: 'application/json', body: '[]' });
  });
  await p.goto(BASE + '/superadmin.html', { waitUntil: 'load' });
  await p.fill('#sa-url-input', 'https://x.supabase.co');
  await p.fill('#sa-key-input', 'chave');
  await p.click('button:has-text("Entrar como Superadmin")');
  await p.waitForTimeout(1200);
  return { b, p, erros, chamadas };
}
const excluir = async (p, digitado) => {
  p.removeAllListeners('dialog');
  p.on('dialog', d => (d.type() === 'prompt' ? d.accept(digitado) : d.accept()));
  await p.click('[data-acao="deleteTenant"]');
  await p.waitForTimeout(500);
};
const toast = p => p.evaluate(() => document.body.innerText);

(async () => {
  const todos = [];

  console.log('== Exclusão confirmada ==');
  {
    const { b, p, erros, chamadas } = await abrir({
      status: 200,
      corpo: { ok: true, cliente: NOME, dependencias: 40 }
    });
    checa('o nome do cliente aparece como texto', (await p.$$('#tenant-tbody b')).length === 0);
    await excluir(p, NOME);
    const rpc = chamadas.filter(c => c.u.includes('rpc/a1_sa_excluir_cliente'));
    checa(
      'uma única chamada ao banco, com o id do cliente',
      rpc.length === 1 && JSON.parse(rpc[0].corpo).p_tenant === TENANTS[0].id,
      JSON.stringify(rpc)
    );
    checa(
      'nenhum DELETE solto saiu do navegador',
      !chamadas.some(c => c.m === 'DELETE'),
      JSON.stringify(chamadas.map(c => c.m + ' ' + c.u))
    );
    checa('avisa que excluiu', /excluído permanentemente/.test(await toast(p)));
    await b.close();
    todos.push(...erros);
  }

  console.log('\n== Nome digitado errado ==');
  {
    const { b, p, erros, chamadas } = await abrir({ status: 200, corpo: { ok: true } });
    await excluir(p, 'outro nome');
    checa('não chama nada', chamadas.length === 0, JSON.stringify(chamadas));
    await b.close();
    todos.push(...erros);
  }

  console.log('\n== Banco recusou ==');
  {
    const { b, p, erros } = await abrir({
      status: 409,
      corpo: { code: '23503', message: 'dependencias_nao_resolvidas' }
    });
    await excluir(p, NOME);
    checa('avisa que nada foi apagado', /Nada foi apagado/.test(await toast(p)));
    await b.close();
    todos.push(...erros);
  }

  console.log('\n== Função ainda não instalada ==');
  {
    const { b, p, erros } = await abrir({ status: 404, corpo: { message: 'not found' } });
    await excluir(p, NOME);
    checa('avisa que falta instalar e que nada foi apagado', /ainda não foi instalada/.test(await toast(p)));
    await b.close();
    todos.push(...erros);
  }

  if (todos.length) {
    console.log('\n  ERROS DE JS:');
    todos.forEach(e => console.log('    ' + e));
  }
  console.log(
    `\n${bad || todos.length ? '>>> FALHAS: ' + (bad + todos.length) : '>>> tudo passou'}  (${ok} verificações ok)`
  );
  process.exit(bad || todos.length ? 1 : 0);
})().catch(e => {
  console.error(e);
  process.exit(1);
});
