// Disposição de unidades: a tela do mapa, a ficha, a reserva, as ações do
// gestor, o que o corretor vê e o painel; e as sub-telas de Configurações.
//
// A primeira pergunta é a negativa, como em todo módulo novo: sem a licença
// DISPOSICAO nada disso pode existir na tela. Depois, que tudo anda por ID: a
// unidade clicada é a unidade reservada, com a versão que a tela leu. O banco
// trava e confere de novo (testes/sql/prova-disposicao.sql); aqui se prova
// que a tela manda o pedido certo.
const { abrir, checa, resumo } = require('./comum');
const { D, DISP } = require('./fake');

// Só neste processo: o corretor p3 ganha as permissões da Disposição. Cada
// arquivo de teste roda isolado, então os outros continuam vendo o p3 de sempre.
const P3 = D.partners.find(x => x.id === 'p3');
const CORRETOR = {
  id: 'p3',
  tenant_id: 't1',
  name: 'Ana Souza',
  role: 'partner',
  type: 'corretor',
  cpf: '33333333333'
};

const corpos = (p, re) =>
  p.evaluate(
    r =>
      window.__POSTS
        .filter(x => new RegExp(r).test(x.url))
        .map(x => ({ m: x.m, url: x.url, body: JSON.parse(x.body || 'null') })),
    re.source
  );

(async () => {
  let todosErros = [];

  // ── 1. Sem licença ─────────────────────────────────────────────────────────
  console.log('\nSem a licença DISPOSICAO');
  {
    const { b, p, erros } = await abrir('thecred/disposicao');
    checa('a planta não é montada', (await p.$$('.un')).length === 0);
    checa('nenhuma ação de reserva existe no DOM', (await p.$$('[data-acao="iniciarReserva"]')).length === 0);
    await b.close();
    todosErros = todosErros.concat(erros);
  }
  {
    const { b, p, erros } = await abrir('thecred/configuracoes', { modulos: ['COMERCIAL'] });
    await p.waitForTimeout(600);
    checa(
      'em Configurações, o grupo da Disposição fica sem cartão nenhum',
      (await p.$$('#cfg-sec-disposicao .cfg-hub-card')).length === 0
    );
    checa('nem a sub-tela de unidades existe', !(await p.$('#cfg-view-disp-unidades')));
    checa(
      'e o casco não oferece a aba',
      !(await p.$('#sb-casco a[href*="/disposicao"]')),
      await p.evaluate(() =>
        [...document.querySelectorAll('#sb-casco a')].map(a => a.getAttribute('href')).join(' ')
      )
    );
    await b.close();
    todosErros = todosErros.concat(erros);
  }

  // ── 2. Gestor: a planta ────────────────────────────────────────────────────
  console.log('\nGestor: a planta');
  {
    const { b, p, erros } = await abrir('thecred/disposicao', { modulos: ['DISPOSICAO', 'COMERCIAL'] });
    await p.waitForTimeout(500);
    const conta = async c => (await p.$$('.un.' + c)).length;
    const esperado = s => DISP.unidades.filter(u => u.status === s).length;
    checa('as 16 unidades aparecem', (await p.$$('.un')).length === 16, String((await p.$$('.un')).length));
    for (const s of ['disponivel', 'reservado', 'vendido', 'bloqueado'])
      checa(`${esperado(s)} ${s}`, (await conta('un-' + s)) === esperado(s), String(await conta('un-' + s)));
    const ids = await p.$$eval('.un', l => l.map(e => e.getAttribute('data-id')));
    checa(
      'cada unidade carrega o próprio id',
      ids.every(id => DISP.unidades.some(u => u.id === id)),
      ids.join(',')
    );
    checa('a tipologia com HTML aparece como texto', (await p.evaluate(() => window.__XSS)) === 0);

    // Ficha e ações do gestor numa disponível
    await p.click('.un[data-id="un-03"]');
    await p.waitForTimeout(400);
    const ficha = await p.textContent('#dp-gaveta');
    checa('a ficha abre com o código', /B1-003/.test(ficha));
    checa('e o valor do mapa ativo', /200\.000,00/.test(ficha), ficha.slice(0, 200));
    checa('o gestor vê Reservar', !!(await p.$('#dp-gaveta [data-acao="iniciarReserva"][data-id="un-03"]')));
    checa('e Bloquear', !!(await p.$('#dp-gaveta [data-acao="perguntar"][data-tipo="bloquear"]')));

    // Bloquear sem motivo: a tela pergunta antes de ir ao banco
    await p.evaluate(() => (window.__POSTS = []));
    await p.click('#dp-gaveta [data-acao="perguntar"][data-tipo="bloquear"]');
    await p.click('#dp-pg-ok');
    await p.waitForTimeout(200);
    checa('bloquear sem motivo não sai da tela', (await corpos(p, /a1_unidade_definir_status/)).length === 0);
    checa('e diz o que falta', /motivo/i.test(await p.textContent('#dp-pg-erro')));
    await p.fill('#pg-motivo', 'Permuta com o terreno');
    await p.click('#dp-pg-ok');
    await p.waitForTimeout(500);
    const bl = (await corpos(p, /a1_unidade_definir_status/))[0];
    checa(
      'com motivo, o pedido leva o id, a situação, o motivo e a versão lida',
      bl &&
        bl.body.p_unidade === 'un-03' &&
        bl.body.p_status === 'bloqueado' &&
        bl.body.p_motivo === 'Permuta com o terreno' &&
        bl.body.p_versao_esperada === 1,
      JSON.stringify(bl && bl.body)
    );
    await b.close();
    todosErros = todosErros.concat(erros);
  }

  // ── 3. Gestor: a reserva ───────────────────────────────────────────────────
  console.log('\nGestor: a reserva em três passos');
  {
    const { b, p, erros } = await abrir('thecred/disposicao', { modulos: ['DISPOSICAO', 'COMERCIAL'] });
    await p.waitForTimeout(500);
    await p.click('.un[data-id="un-11"]');
    await p.waitForTimeout(300);
    await p.click('[data-acao="iniciarReserva"]');
    await p.waitForTimeout(300);
    await p.fill('#t-nome', 'Maria Andrade');
    await p.fill('#t-cpf', '111.111.111-11');
    await p.click('[data-acao="rsPasso"][data-passo="2"]');
    await p.waitForTimeout(200);
    checa('CPF inválido segura no primeiro passo', !(await p.$('#fx-0-val')));
    await p.fill('#t-cpf', '529.982.247-25');
    await p.click('[data-acao="rsPasso"][data-passo="2"]');
    await p.waitForTimeout(300);
    checa('com CPF válido, abre o fluxo', !!(await p.$('#fx-0-val')));
    // Ato de 25 mil + 36 mensais de 500 + o resto em semestrais, completado pela tela
    await p.fill('#fx-0-val', '25000');
    await p.dispatchEvent('#fx-0-val', 'change');
    await p.fill('#fx-0-venc', '2026-11-20');
    await p.dispatchEvent('#fx-0-venc', 'change');
    await p.click('[data-acao="rsAddLinha"]');
    await p.waitForTimeout(150);
    await p.fill('#fx-1-qtd', '36');
    await p.dispatchEvent('#fx-1-qtd', 'change');
    await p.fill('#fx-1-val', '500');
    await p.dispatchEvent('#fx-1-val', 'change');
    await p.fill('#fx-1-venc', '2026-12-20');
    await p.dispatchEvent('#fx-1-venc', 'change');
    await p.click('[data-acao="rsAddLinha"]');
    await p.waitForTimeout(150);
    await p.fill('#fx-2-venc', '2027-06-20');
    await p.dispatchEvent('#fx-2-venc', 'change');
    await p.click('[data-acao="rsCompletar"][data-i="2"]');
    await p.waitForTimeout(200);
    await p.click('[data-acao="rsPasso"][data-passo="3"]');
    await p.waitForTimeout(300);
    await p.evaluate(() => (window.__POSTS = []));
    await p.click('#rs-ok');
    await p.waitForTimeout(700);
    const rs = (await corpos(p, /rpc\/a1_unidade_reservar/))[0];
    const c = rs && rs.body;
    const preco = DISP.itens.find(i => i.unidade_id === 'un-11').valor;
    const soma = c ? c.p_fluxo.reduce((t, l) => t + Number(l.valor) * Number(l.quantidade), 0) : 0;
    checa('a reserva vai para a unidade clicada', c && c.p_unidade === 'un-11', JSON.stringify(c));
    checa('com a versão que a tela leu', c && c.p_versao_esperada === 1);
    checa(
      'com o titular e o CPF só em dígitos',
      c && c.p_cliente.titular.nome === 'Maria Andrade' && c.p_cliente.titular.cpf === '52998224725',
      JSON.stringify(c && c.p_cliente)
    );
    checa(
      'cada linha do fluxo aponta o parâmetro por id',
      c && c.p_fluxo.every(l => /^pp\d$/.test(l.parametro_id))
    );
    checa('e o fluxo fecha no valor da unidade', Math.abs(soma - preco) < 0.01, `${soma} x ${preco}`);
    checa(
      'a tela de sucesso oferece abrir a venda criada',
      !!(await p.$('[data-acao="rsAbrirVenda"][data-id="co1"]'))
    );
    checa('XSS = 0', (await p.evaluate(() => window.__XSS)) === 0);
    await b.close();
    todosErros = todosErros.concat(erros);
  }

  // ── 4. Corretor ────────────────────────────────────────────────────────────
  console.log('\nCorretor (parceiro com disp_ver e disp_reservar)');
  {
    const antes = P3.permissions;
    P3.permissions = { disp_ver: true, disp_reservar: true };
    const { b, p, erros } = await abrir('thecred/disposicao?vista=dashboard', {
      modulos: ['DISPOSICAO', 'COMERCIAL'],
      usuario: CORRETOR
    });
    await p.waitForTimeout(500);
    checa(
      'sem a permissão do painel, cai na planta',
      !(await p.isHidden('#vista-mapa')) && (await p.isHidden('#vista-dashboard'))
    );
    await p.click('.un[data-id="un-03"]');
    await p.waitForTimeout(300);
    checa('pode reservar', !!(await p.$('#dp-gaveta [data-acao="iniciarReserva"]')));
    checa('mas não bloqueia', !(await p.$('#dp-gaveta [data-tipo="bloquear"]')));
    checa('nem marca como vendida', !(await p.$('#dp-gaveta [data-tipo="vender"]')));
    await p.click('[data-acao="fecharFicha"]');
    await p.click('.un[data-id="un-12"]');
    await p.waitForTimeout(300);
    checa('cancela a própria reserva', !!(await p.$('#dp-gaveta [data-tipo="cancelar"]')));
    checa('mas não prorroga', !(await p.$('#dp-gaveta [data-tipo="prorrogar"]')));
    await b.close();
    todosErros = todosErros.concat(erros);
    P3.permissions = antes;
  }
  {
    P3.permissions = { disp_ver: false };
    const { b, p, erros } = await abrir('thecred/disposicao', { modulos: ['DISPOSICAO'], usuario: CORRETOR });
    await p.waitForTimeout(300);
    checa(
      'sem disp_ver, a tela explica e não monta a planta',
      (await p.$$('.un')).length === 0 && /Sem acesso/.test(await p.textContent('body'))
    );
    await b.close();
    todosErros = todosErros.concat(erros);
  }

  // ── 5. Reservas e painel ───────────────────────────────────────────────────
  console.log('\nReservas e painel');
  {
    const { b, p, erros } = await abrir('thecred/disposicao?vista=reservas', { modulos: ['DISPOSICAO'] });
    await p.waitForTimeout(400);
    const t = await p.textContent('#vista-reservas');
    checa('a lista mostra a reserva ativa', /RS-000001/.test(t));
    checa('com o CPF mascarado', !/52998224725|529\.982\.247-25/.test(t), t.slice(0, 300));
    checa('e o nome com HTML como texto', (await p.evaluate(() => window.__XSS)) === 0);
    await b.close();
    todosErros = todosErros.concat(erros);
  }
  {
    const { b, p, erros } = await abrir('thecred/disposicao?vista=dashboard', { modulos: ['DISPOSICAO'] });
    await p.waitForTimeout(600);
    const t = await p.textContent('#vista-dashboard');
    checa('o painel abre para o gestor', !(await p.isHidden('#vista-dashboard')));
    checa('com o VGV vendido como número principal', /vendido/i.test(t) && /%/.test(t));
    checa(
      'VSO, meses de estoque e ticket médio',
      /VSO/.test(t) && /estoque/i.test(t) && /ticket/i.test(t),
      t.slice(0, 400)
    );
    checa(
      'o gráfico tem a tabela alternativa',
      !!(await p.$('#vista-dashboard svg')) && !!(await p.$('#vista-dashboard table'))
    );
    await b.close();
    todosErros = todosErros.concat(erros);
  }

  // ── 6. Configurações ───────────────────────────────────────────────────────
  console.log('\nConfigurações da Disposição');
  {
    const { b, p, erros } = await abrir('thecred/configuracoes', { modulos: ['DISPOSICAO'] });
    await p.waitForTimeout(700);
    checa('com a licença, quatro cartões', (await p.$$('#cfg-sec-disposicao .cfg-hub-card')).length === 4);
    await p.click('#cfg-card-disp-unidades');
    await p.waitForTimeout(500);
    checa(
      'a lista de unidades traz todas, com Editar em cada uma',
      (await p.$$('#dc-unidades [data-acao="dcEditarUnidade"]')).length === 16
    );
    await p.click('#dc-unidades [data-acao="dcEditarUnidade"][data-id="un-01"]');
    await p.waitForTimeout(200);
    await p.fill('#dcu-vagas', '3');
    await p.evaluate(() => (window.__POSTS = []));
    await p.click('[data-acao="dcSalvarUnidade"]');
    await p.waitForTimeout(400);
    const ed = await corpos(p, /a1_unidades/);
    checa(
      'editar uma unidade é PATCH nela, pelo id',
      ed.length === 1 && ed[0].m === 'PATCH' && /id=eq\.un-01/.test(ed[0].url) && ed[0].body.vagas === 3,
      JSON.stringify(ed)
    );
    checa('e não manda situação nem versão', ed[0] && !('status' in ed[0].body) && !('versao' in ed[0].body));

    // Edição em massa: só o que foi preenchido
    await p.click('#dc-unidades [data-acao-change="dcSelecionar"][data-id="un-02"]');
    await p.click('#dc-unidades [data-acao-change="dcSelecionar"][data-id="un-03"]');
    await p.click('[data-acao="dcEditarVarias"]');
    await p.waitForTimeout(200);
    await p.fill('#dcu-tipologia', 'Garden');
    await p.evaluate(() => (window.__POSTS = []));
    await p.click('[data-acao="dcSalvarVarias"]');
    await p.waitForTimeout(400);
    const mv = (await corpos(p, /a1_unidades/))[0];
    checa(
      'a edição em massa vai só com os campos preenchidos, para os ids marcados',
      mv &&
        mv.m === 'PATCH' &&
        /id=in\.\(un-02,un-03\)/.test(mv.url) &&
        JSON.stringify(mv.body) === '{"tipologia":"Garden"}',
      JSON.stringify(mv)
    );

    // Mapa de preço: marcar todas não pode redesenhar e perder o digitado
    await p.click('#cfg-view-disp-unidades [data-acao="closeCfgView"]');
    await p.click('#cfg-card-disp-precos');
    await p.waitForTimeout(500);
    await p.fill('#dc-precos .dc-preco[data-id="un-01"]', '199.000,00');
    await p.click('#dc-precos [data-acao-change="dcSelecionarTodas"]');
    await p.waitForTimeout(200);
    checa(
      'marcar todas mantém o valor digitado',
      (await p.inputValue('#dc-precos .dc-preco[data-id="un-01"]')) === '199.000,00'
    );
    checa(
      'e marca as 16',
      (await p.$$eval(
        '#dc-precos [data-acao-change="dcSelecionar"]',
        l => l.filter(c => c.checked).length
      )) === 16
    );
    await p.evaluate(() => (window.__POSTS = []));
    await p.click('[data-acao="dcSalvarPrecos"]');
    await p.waitForTimeout(400);
    const pr = (await corpos(p, /a1_mapa_preco_itens/))[0];
    checa(
      'salvar preços manda só o que mudou, por mapa e unidade',
      pr &&
        /on_conflict=mapa_id,unidade_id/.test(pr.url) &&
        pr.body.length === 1 &&
        pr.body[0].unidade_id === 'un-01' &&
        pr.body[0].valor === 199000 &&
        pr.body[0].mapa_id === 'mp1',
      JSON.stringify(pr)
    );
    checa('XSS = 0', (await p.evaluate(() => window.__XSS)) === 0);
    await b.close();
    todosErros = todosErros.concat(erros);
  }

  // ── 7. A venda que nasce da reserva ────────────────────────────────────────
  console.log('\nVenda aberta pela reserva');
  {
    const co = D.comerciais.find(x => x.id === 'co1');
    const antes = co.proposta;
    co.proposta = {
      valor_venda: 20000000,
      condicoes_pagamento: [
        { tipo: 'SINAL', nome: 'Sinal', quantidade: 1, valor: 1000000, vencimento_inicial: '2026-11-20' },
        {
          tipo: 'FIN_DIRETO',
          nome: 'Financiamento direto',
          quantidade: 24,
          valor: 50000,
          vencimento_inicial: '2026-12-20'
        }
      ]
    };
    const { b, p, erros } = await abrir('thecred/comercial?id=co1', { modulos: ['COMERCIAL'] });
    await p.waitForTimeout(600);
    const sel = await p.$$eval('#p-condicoes [data-campo="tipo"]', l =>
      l.map(s => s.value + '|' + s.options[s.selectedIndex].textContent)
    );
    checa('o Sinal abre como Sinal, e não como Ato', sel[0] === 'SINAL|Sinal', sel.join(' / '));
    checa(
      'um parâmetro próprio da construtora aparece com o nome dele',
      sel[1] === 'FIN_DIRETO|Financiamento direto',
      sel.join(' / ')
    );
    await b.close();
    todosErros = todosErros.concat(erros);
    co.proposta = antes;
  }

  process.exit(resumo(todosErros) ? 1 : 0);
})();
