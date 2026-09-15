// A coluna "Módulos ativos" da lista de clientes, no superadmin.
//
// O RELATO: todo cliente aparecia com "nenhum" — inclusive os que têm
// Pré-análise e Venda ligadas há semanas. Não era licença faltando no banco: era
// ORDEM DE CHEGADA. A carga do painel dispara `Promise.all([loadTenants(),
// loadAllModules(), ...])`, e loadTenants() desenha a tabela assim que a resposta
// DELE volta. Com três clientes e cinco linhas de módulo, os clientes chegavam
// primeiro e a tabela era montada com ALL_MODULES ainda vazio.
//
// Uma corrida não se prova com a rede real: nos testes as duas respostas chegam
// juntas e a coluna pode aparecer certa por sorte. Por isso aqui a resposta de
// a1_tenant_modules é ATRASADA de propósito. Sem o conserto, esta suíte falha
// sempre; com ele, passa sempre.
const { chromium } = require('playwright');
const BASE = 'http://localhost:' + (process.env.PORTA_TESTE || 8099);

let ok = 0, bad = 0;
const checa = (n, v, x = '') => { v ? (ok++, console.log('  ✓ ' + n)) : (bad++, console.log('  ✗ ' + n + '  ' + x)); };

const TENANTS = [
  { id:'t1', name:'THE CRED',      slug:'thecred', status:'active', plan_key:'custom',
    max_users:5, tipo_cliente:'correspondente_bancario', email:'a@x.com', created_at:'2026-01-03' },
  { id:'t2', name:'S T Empreendimentos', slug:'terras', status:'active', plan_key:'starter',
    max_users:3, tipo_cliente:'correspondente_bancario', email:'b@x.com', created_at:'2026-01-02' },
  { id:'t3', name:'Sem Módulo',    slug:'semmod', status:'active', plan_key:'starter',
    max_users:3, tipo_cliente:'construtora', email:'c@x.com', created_at:'2026-01-01' }
];
// t1 com três módulos, t2 com um, t3 com nenhum: é o cenário em que a asserção
// FALHA se o código errar — lista inteira vazia, ou a mesma lista para todos.
const MODULOS = [
  { tenant_id:'t1', module_key:'repasse',     unlocked_at:'2026-06-25T22:01:29Z', expires_at:null },
  { tenant_id:'t1', module_key:'PRE_ANALISE', unlocked_at:'2026-09-08T19:44:36Z', expires_at:null },
  { tenant_id:'t1', module_key:'COMERCIAL',   unlocked_at:'2026-09-08T19:44:33Z', expires_at:null },
  { tenant_id:'t2', module_key:'repasse',     unlocked_at:'2026-08-22T01:29:14Z', expires_at:null }
];

async function abrirSuper({ atrasoModulos = 0 } = {}) {
  const b = await chromium.launch();
  const p = await b.newPage({ viewport: { width: 1500, height: 1000 } });
  const erros = [];
  p.on('pageerror', e => erros.push('JS: ' + e.message));
  await p.route(/fonts\.(googleapis|gstatic)\.com/, r => r.fulfill({ status:200, contentType:'text/css', body:'' }));
  await p.route(/supabase\.co/, async r => {
    const u = r.request().url();
    const j = x => r.fulfill({ status:200, contentType:'application/json', body: JSON.stringify(x) });
    if (u.includes('a1_tenant_modules')) {
      // O atraso é o teste. Ele põe a resposta dos módulos DEPOIS da dos
      // clientes, que é exatamente o que a rede fazia em produção.
      if (atrasoModulos) await new Promise(s => setTimeout(s, atrasoModulos));
      return j(MODULOS);
    }
    if (u.includes('a1_tenants')) return j(TENANTS);
    return j([]);
  });
  await p.goto(BASE + '/superadmin.html', { waitUntil:'load' });
  await p.fill('#sa-url-input', 'https://x.supabase.co');
  await p.fill('#sa-key-input', 'chave');
  await p.click('button:has-text("Entrar como Superadmin")');
  await p.waitForTimeout(1200 + atrasoModulos);
  return { b, p, erros };
}

// Devolve, por cliente, os módulos escritos na célula — conteúdo, não contagem.
const colunaModulos = p => p.evaluate(() =>
  Array.from(document.querySelectorAll('#tenant-tbody tr')).map(tr => {
    const tds = tr.querySelectorAll('td');
    if (tds.length < 8) return null;
    return {
      empresa: tds[0].textContent.trim(),
      modulos: Array.from(tds[7].querySelectorAll('.badge')).map(b => b.textContent.trim())
    };
  }).filter(Boolean));

(async () => {
  const todosErros = [];

  console.log('== OS MÓDULOS CHEGAM DEPOIS DOS CLIENTES ==');
  {
    const { b, p, erros } = await abrirSuper({ atrasoModulos: 700 });
    const linhas = await colunaModulos(p);
    const de = n => (linhas.find(l => l.empresa.includes(n)) || {}).modulos || [];

    checa('as três linhas foram desenhadas', linhas.length === 3, JSON.stringify(linhas));
    // O defeito relatado, com nome: cliente com módulo aparecendo como "nenhum".
    checa('THE CRED mostra os três módulos dele',
      ['repasse','PRE_ANALISE','COMERCIAL'].every(m => de('THE CRED').includes(m)),
      JSON.stringify(de('THE CRED')));
    checa('e mostra SÓ os três', de('THE CRED').length === 3, JSON.stringify(de('THE CRED')));
    // Se o código passasse a mesma lista para todo mundo, esta reprova.
    checa('S T mostra apenas o Repasse',
      JSON.stringify(de('S T Empreendimentos')) === JSON.stringify(['repasse']),
      JSON.stringify(de('S T Empreendimentos')));
    // E "nenhum" continua sendo a resposta certa para quem não tem módulo:
    // o conserto não pode virar módulo aparecendo onde não há.
    checa('cliente sem módulo continua sem módulo', de('Sem Módulo').length === 0,
      JSON.stringify(de('Sem Módulo')));
    checa('e diz "nenhum" por escrito', (await p.evaluate(() =>
      document.querySelectorAll('#tenant-tbody tr')[2].querySelectorAll('td')[7].textContent.trim()
    )) === 'nenhum');
    checa('sem erro de JS', erros.length === 0, erros[0] || '');
    todosErros.push(...erros); await b.close();
  }

  console.log('\n== E SEM ATRASO NENHUM CONTINUA CERTO ==');
  {
    const { b, p, erros } = await abrirSuper();
    const linhas = await colunaModulos(p);
    const de = n => (linhas.find(l => l.empresa.includes(n)) || {}).modulos || [];
    checa('THE CRED com os três', de('THE CRED').length === 3, JSON.stringify(de('THE CRED')));
    checa('S T com o dele', JSON.stringify(de('S T Empreendimentos')) === JSON.stringify(['repasse']),
      JSON.stringify(de('S T Empreendimentos')));
    checa('sem erro de JS', erros.length === 0, erros[0] || '');
    todosErros.push(...erros); await b.close();
  }

  if (todosErros.length) { console.log('\n  ERROS DE JS:'); todosErros.slice(0,5).forEach(e => console.log('    ' + e.slice(0,160))); }
  console.log(`\n${bad + todosErros.length ? '>>> FALHAS: ' + (bad + todosErros.length) : '>>> tudo passou'}  (${ok} verificações ok)`);
  process.exit(bad + todosErros.length ? 1 : 0);
})();
