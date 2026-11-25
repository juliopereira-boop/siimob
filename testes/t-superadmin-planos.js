// Superadmin › Planos: a tabela de preços 2026.
//
// O PEDIDO DO DONO
//   "coloque toda essa tabela nos Planos, do superadmin"
//
// O que este arquivo prova:
//   - a aba mostra os planos por usuários (com valor por usuário e quantos
//     clientes usam), os módulos (disponível / em breve), os pacotes (preço
//     cheio somado dos módulos e desconto) e a calculadora;
//   - salvar um plano manda PATCH só para plano da tabela 2026 (filtro
//     tabela=eq.2026), nunca para um plano antigo em uso;
//   - salvar módulo e pacote manda o que foi digitado;
//   - os planos antigos aparecem à parte, só leitura, com quantos clientes usam;
//   - o cadastro de cliente oferece os planos 2026 e grava o limite do plano;
//   - sem a tabela instalada, o cadastro mantém as opções antigas;
//   - nada vira HTML (XSS).
const { chromium } = require('playwright');
const BASE = 'http://localhost:' + (process.env.PORTA_TESTE || 8099);

let ok = 0,
  bad = 0;
const checa = (n, v, x = '') => {
  v ? (ok++, console.log('  ✓ ' + n)) : (bad++, console.log('  ✗ ' + n + '  ' + x));
};
const XSS = '<img src=x onerror="window.__XSS=(window.__XSS||0)+1">';

const TENANTS = [
  {
    id: 't1',
    name: 'THE CRED',
    slug: 'thecred',
    status: 'active',
    plan_key: 'custom',
    max_users: 5,
    tipo_cliente: 'correspondente_bancario',
    email: 'a@x.com',
    created_at: '2026-01-03'
  },
  {
    id: 't2',
    name: 'S T',
    slug: 'terras',
    status: 'active',
    plan_key: 'starter',
    max_users: 3,
    tipo_cliente: 'construtora',
    email: 'b@x.com',
    created_at: '2026-01-02'
  },
  {
    id: 't3',
    name: 'Vella',
    slug: 'vellaimob',
    status: 'active',
    plan_key: 'ate20',
    max_users: 20,
    tipo_cliente: 'imobiliaria',
    email: 'c@x.com',
    created_at: '2026-01-01'
  }
];
const PLANOS = [
  { key: 'starter', name: 'Starter', max_users: 3, price_brl: 600, tabela: null },
  { key: 'pro', name: 'Pro', max_users: 10, price_brl: 1200, tabela: null },
  { key: 'ate8', name: 'Até 8 usuários', max_users: 8, price_brl: 800, tabela: '2026', ordem: 1 },
  { key: 'ate20', name: 'Até 20 usuários ' + XSS, max_users: 20, price_brl: 1500, tabela: '2026', ordem: 2 },
  { key: 'ate100', name: 'Até 100 usuários', max_users: 100, price_brl: 5200, tabela: '2026', ordem: 5 }
];
const PRECOS = [
  {
    chave: 'crm',
    tipo: 'modulo',
    nome: 'CRM completo',
    descricao: 'Funil ' + XSS,
    modulo_key: 'crm',
    modulos: [],
    status: 'disponivel',
    preco_brl: 390,
    ordem: 1
  },
  {
    chave: 'atendimento',
    tipo: 'modulo',
    nome: 'Central de Atendimento com IA',
    descricao: 'ELIA',
    modulo_key: 'ATENDIMENTO',
    modulos: [],
    status: 'disponivel',
    preco_brl: 690,
    ordem: 2
  },
  {
    chave: 'venda',
    tipo: 'modulo',
    nome: 'Venda',
    descricao: '',
    modulo_key: 'COMERCIAL',
    modulos: [],
    status: 'disponivel',
    preco_brl: 290,
    ordem: 3
  },
  {
    chave: 'financeiro',
    tipo: 'modulo',
    nome: 'Financeiro',
    descricao: '',
    modulo_key: 'financeiro',
    modulos: [],
    status: 'em_breve',
    preco_brl: 350,
    ordem: 9
  },
  {
    chave: 'imobiliaria_digital',
    tipo: 'pacote',
    nome: 'Imobiliária Digital',
    descricao: '',
    modulo_key: null,
    modulos: ['crm', 'atendimento', 'venda'],
    status: 'disponivel',
    preco_brl: 1190,
    ordem: 1
  },
  {
    chave: 'usuario_extra',
    tipo: 'usuario_extra',
    nome: 'Usuário adicional',
    descricao: '',
    modulo_key: null,
    modulos: [],
    status: 'disponivel',
    preco_brl: 45,
    ordem: 1
  }
];

async function abrirSuper({ semTabela = false } = {}) {
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
    const corpo = r.request().postData();
    const j = (x, st = 200) =>
      r.fulfill({ status: st, contentType: 'application/json', body: JSON.stringify(x) });
    if (m !== 'GET') chamadas.push({ u, m, corpo: corpo ? JSON.parse(corpo) : null });
    if (u.includes('/a1_plans')) {
      if (m === 'PATCH') {
        const key = decodeURIComponent((u.match(/key=eq\.([^&]+)/) || [])[1] || '');
        const p2 = PLANOS.find(x => x.key === key && x.tabela === '2026');
        return j(p2 && u.includes('tabela=eq.2026') ? [{ ...p2, ...JSON.parse(corpo) }] : []);
      }
      return j(semTabela ? PLANOS.filter(x => !x.tabela) : PLANOS);
    }
    if (u.includes('/a1_precos')) {
      if (m === 'PATCH') {
        const chave = decodeURIComponent((u.match(/chave=eq\.([^&]+)/) || [])[1] || '');
        const it = PRECOS.find(x => x.chave === chave);
        return j(it ? [{ ...it, ...JSON.parse(corpo) }] : []);
      }
      return j(semTabela ? [] : PRECOS);
    }
    if (u.includes('a1_tenant_modules')) return j([]);
    if (u.includes('/a1_tenants') && m === 'POST') return j([{ id: 'novo', ...JSON.parse(corpo) }]);
    if (u.includes('/a1_tenants')) return j(TENANTS);
    return j([]);
  });
  await p.goto(BASE + '/superadmin.html', { waitUntil: 'load' });
  await p.fill('#sa-url-input', 'https://x.supabase.co');
  await p.fill('#sa-key-input', 'chave');
  await p.click('button:has-text("Entrar como Superadmin")');
  await p.waitForTimeout(1300);
  return { b, p, erros, chamadas };
}

(async () => {
  const todosErros = [];

  console.log('== Aba Planos ==');
  {
    const { b, p, erros, chamadas } = await abrirSuper();
    await p.click('.sa-tab[data-name="planos"]');
    await p.waitForTimeout(300);
    const linhaPlano = k => p.$(`#precos-tabela tr[data-plano="${k}"]`);
    checa(
      'os 3 planos 2026 aparecem, em ordem',
      (await p.$$eval('#precos-tabela tr[data-plano]', l => l.map(x => x.dataset.plano))).join() ===
        'ate8,ate20,ate100'
    );
    const ate20 = await (await linhaPlano('ate20')).textContent();
    checa(
      'mostra valor por usuário e quantos clientes usam',
      /R\$ 75/.test(ate20) && /\b1\b/.test(ate20),
      ate20
    );
    checa(
      'o nome vem no campo, como texto',
      (await p.inputValue('tr[data-plano="ate20"] [data-campo="name"]')).includes('<img')
    );

    await p.fill('tr[data-plano="ate20"] [data-campo="price_brl"]', '1.600,50');
    await p.fill('tr[data-plano="ate20"] [data-campo="max_users"]', '22');
    await p.click('tr[data-plano="ate20"] [data-acao="precoSalvarPlano"]');
    await p.waitForTimeout(400);
    const pat = chamadas.find(c => c.m === 'PATCH' && c.u.includes('/a1_plans'));
    checa(
      'salvar o plano manda PATCH só para a tabela 2026',
      !!pat && /key=eq\.ate20/.test(pat.u) && /tabela=eq\.2026/.test(pat.u),
      pat && pat.u
    );
    checa(
      'com preço (vírgula como decimal) e limite digitados',
      !!pat && pat.corpo.price_brl === 1600.5 && pat.corpo.max_users === 22,
      JSON.stringify(pat && pat.corpo)
    );

    const mods = await p.$$eval('#precos-tabela tr[data-item]', l => l.map(x => x.dataset.item));
    checa(
      'módulos e pacote aparecem',
      ['crm', 'atendimento', 'venda', 'financeiro', 'imobiliaria_digital'].every(k => mods.includes(k)),
      mods.join()
    );
    checa(
      'financeiro marcado como Em breve',
      (await p.inputValue('tr[data-item="financeiro"] [data-campo="status"]')) === 'em_breve'
    );
    const pac = await p.textContent('tr[data-item="imobiliaria_digital"]');
    checa(
      'pacote soma o preço cheio dos módulos e mostra o desconto',
      /R\$ 1\.370/.test(pac) && /13%/.test(pac),
      pac
    );

    checa(
      'módulo Em breve não entra na calculadora',
      await p.isDisabled('.pr-mods input[value="financeiro"]')
    );
    await p.selectOption('tr[data-item="financeiro"] [data-campo="status"]', 'disponivel');
    await p.fill('tr[data-item="financeiro"] [data-campo="preco_brl"]', '390');
    await p.click('tr[data-item="financeiro"] [data-acao="precoSalvarItem"]');
    await p.waitForTimeout(400);
    const pm = chamadas.find(
      c => c.m === 'PATCH' && c.u.includes('/a1_precos') && c.u.includes('chave=eq.financeiro')
    );
    checa(
      'salvar módulo manda situação e preço',
      !!pm && pm.corpo.status === 'disponivel' && pm.corpo.preco_brl === 390,
      JSON.stringify(pm && pm.corpo)
    );

    await p.fill('.pr-extra [data-campo="preco_brl"]', '50');
    await p.click('.pr-extra [data-acao="precoSalvarItem"]');
    await p.waitForTimeout(300);
    checa(
      'usuário adicional salva',
      chamadas.some(
        c => c.m === 'PATCH' && c.u.includes('chave=eq.usuario_extra') && c.corpo.preco_brl === 50
      )
    );

    // calculadora: 15 usuários (cai em "até 20") + CRM + Central
    await p.fill('#pr-c-usuarios', '15');
    await p.check('.pr-mods input[value="crm"]');
    await p.check('.pr-mods input[value="atendimento"]');
    const total = await p.textContent('#pr-c-total');
    checa('calculadora: plano da faixa (até 20) + módulos', /R\$ 2\.580/.test(total), total);
    await p.fill('#pr-c-usuarios', '110');
    const total2 = await p.textContent('#pr-c-total');
    checa('acima de 100: maior plano + usuários adicionais', /10 adicionais/.test(total2), total2);

    const antigos = await p.textContent('#precos-tabela');
    checa(
      'planos anteriores à parte, com quantos clientes usam',
      /Planos anteriores/.test(antigos) && /starter/.test(antigos)
    );
    checa('nenhuma carga de XSS executou', (await p.evaluate(() => window.__XSS || 0)) === 0);
    await b.close();
    todosErros.push(...erros);
  }

  console.log('\n== Cadastro de cliente usa a tabela 2026 ==');
  {
    const { b, p, erros, chamadas } = await abrirSuper();
    const opcoes = await p.$$eval('#n-plan option', l => l.map(o => o.value));
    checa(
      'o cadastro oferece os planos 2026 e Customizado',
      opcoes.join() === 'ate8,ate20,ate100,custom',
      opcoes.join()
    );
    await p.evaluate(() => {
      const sel = document.getElementById('n-plan');
      sel.value = 'ate100';
      sel.dispatchEvent(new Event('change', { bubbles: true }));
    });
    await p.evaluate(() => {
      const v = (id, x) => (document.getElementById(id).value = x);
      v('n-name', 'Nova');
      v('n-slug', 'nova');
      v('n-email', 'n@x.com');
      v('n-owner-name', 'Dono');
      v('n-owner-cpf', '12345678909');
      v('n-owner-pw', 'segredo1');
    });
    await p.click('[data-acao="createTenant"]').catch(() => {});
    await p.waitForTimeout(500);
    const post = chamadas.find(c => c.m === 'POST' && c.u.includes('/a1_tenants'));
    checa(
      'o cliente novo grava o plano e o limite dele',
      !!post && post.corpo.plan_key === 'ate100' && post.corpo.max_users === 100,
      JSON.stringify(post && post.corpo)
    );
    await b.close();
    todosErros.push(...erros);
  }

  console.log('\n== Sem a tabela instalada ==');
  {
    const { b, p, erros } = await abrirSuper({ semTabela: true });
    const opcoes = await p.$$eval('#n-plan option', l => l.map(o => o.value));
    checa(
      'o cadastro mantém as opções antigas',
      opcoes.join() === 'starter,pro,enterprise,custom',
      opcoes.join()
    );
    await p.click('.sa-tab[data-name="planos"]');
    await p.waitForTimeout(200);
    checa(
      'a aba avisa que a tabela não foi instalada',
      /ainda não foi instalada/.test(await p.textContent('#precos-tabela'))
    );
    await b.close();
    todosErros.push(...erros);
  }

  if (todosErros.length) {
    console.log('\n  ERROS DE JS:');
    todosErros.forEach(e => console.log('    ' + e));
  }
  console.log(
    `\n${bad || todosErros.length ? '>>> FALHAS: ' + (bad + todosErros.length) : '>>> tudo passou'}  (${ok} verificações ok)`
  );
  process.exit(bad || todosErros.length ? 1 : 0);
})().catch(e => {
  console.error(e);
  process.exit(1);
});
