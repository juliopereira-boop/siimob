// Configuração da ELIA (/:slug/configuracoes/elia).
//
// O que este arquivo prova:
//   - sem a licença ATENDIMENTO, o painel não carrega nada;
//   - abas, perfil, conhecimento, editor de fluxo, simulação e campanhas
//     funcionam pelo padrão do sistema (data-acao + acoes): nenhum botão usa
//     outro mecanismo e não há handler inline;
//   - o que vai para a função é o que a pessoa preencheu;
//   - telefone na lista de contatos fica fosco (LGPD);
//   - nada vira HTML (XSS).
const { abrir, checa, resumo } = require('./comum');

const XSS = '<img src=x onerror="window.__XSS=(window.__XSS||0)+1">';

function servidor(est) {
  return (url, metodo, corpo) => {
    if (!/functions\/v1\/elia/.test(url) || metodo !== 'POST') return undefined;
    const d = JSON.parse(corpo || '{}');
    est.chamadas.push(d);
    if (d.action === 'load')
      return {
        profile: { nome: 'ELIA', funcao: 'SDR ' + XSS, tom: 'normal', empreendimentos: [] },
        flow: [],
        enabled: false,
        google: false,
        googleReady: false,
        campaigns: [{ id: 'cp1', title: 'Feirão ' + XSS, status: 'queued' }],
        jobs: [],
        stages: [{ id: 'st1', name: 'Em atendimento' }],
        partners: [{ id: 'p1', name: 'Ana ' + XSS }]
      };
    if (d.action === 'save') return { ok: true };
    if (d.action === 'simulate')
      return { trace: ['Mensagem recebida', 'Responder com OpenAI'], output: 'Olá! ' + XSS };
    if (d.action === 'contacts')
      return {
        contacts: [
          { id: 'c1', client_name: 'Joana ' + XSS, client_phone: '(98) 98123-4567', consent: true },
          { id: 'c2', client_name: 'Pedro', client_phone: '(98) 97777-1111', consent: false }
        ]
      };
    if (d.action === 'consent') return { ok: true };
    if (d.action === 'campaign') return { ok: true };
    if (d.action === 'campaignJobs')
      return [{ status: 'sent', a1_cases: { client_name: 'Joana ' + XSS }, detail: '' }];
    return { __status: 400, corpo: { error: 'Ação inválida.' } };
  };
}

(async () => {
  const todos = [];

  console.log('== Sem a licença ==');
  {
    const est = { chamadas: [] };
    const { b, p, erros } = await abrir('thecred/configuracoes/elia', {
      antes: servidor(est),
      modulos: ['crm']
    });
    checa('avisa que o módulo está desativado', /desativado/.test(await p.textContent('[data-el-status]')));
    checa(
      'nenhuma aba e nenhum pedido à ELIA',
      (await p.$$('nav button')).length === 0 && est.chamadas.length === 0
    );
    await b.close();
    todos.push(...erros);
  }

  console.log('\n== Com a licença ==');
  const est = { chamadas: [] };
  const { b, p, erros } = await abrir('thecred/configuracoes/elia', {
    antes: servidor(est),
    modulos: ['crm', 'ATENDIMENTO']
  });
  await p.waitForSelector('nav [data-acao="eliaAba"]');
  checa('cinco abas, todas pelo padrão data-acao', (await p.$$('nav [data-acao="eliaAba"]')).length === 5);
  checa(
    'nenhum elemento usa o despacho antigo (data-el) nem handler inline',
    await p.evaluate(
      () =>
        !document.querySelector('[data-el]') &&
        ![...document.querySelectorAll('*')].some(el => [...el.attributes].some(a => /^on/i.test(a.name)))
    )
  );

  console.log('\n-- Perfil --');
  await p.fill('[data-profile="nome"]', 'ELIA Vella');
  await p.selectOption('[data-profile="tom"]', 'formal');
  await p.selectOption('[data-profile="responsavel"]', 'p1');
  await p.check('[data-profile="enabled"]');
  await p.click('[data-acao="eliaSalvar"]');
  await p.waitForTimeout(300);
  const salvo = est.chamadas.filter(c => c.action === 'save').pop();
  checa(
    'salvar manda o que foi preenchido',
    !!salvo &&
      salvo.profile.nome === 'ELIA Vella' &&
      salvo.profile.tom === 'formal' &&
      salvo.profile.responsavel === 'p1' &&
      salvo.enabled === true,
    JSON.stringify(salvo && salvo.profile)
  );
  checa('o selo do topo vira "Agente ativo"', /Agente ativo/.test(await p.textContent('[data-el-enabled]')));
  checa('status confirma', /Configuração salva/.test(await p.textContent('[data-el-status]')));

  console.log('\n-- Conhecimento --');
  await p.click('nav [data-key="base"]');
  checa('a aba troca o título', /Conhecimento/.test(await p.textContent('[data-el-title]')));
  await p.click('.elia-records:has([data-key="empreendimentos"]) summary');
  await p.click('[data-acao="eliaAddItem"][data-key="empreendimentos"]');
  await p.fill('[data-record="empreendimentos"] [data-field="titulo"]', 'Residencial Jardins');
  await p.fill('[data-record="empreendimentos"] [data-field="descricao"]', '2 quartos, 48 m²');
  await p.click('[data-acao="eliaSalvar"]');
  await p.waitForTimeout(300);
  const comEmp = est.chamadas.filter(c => c.action === 'save').pop();
  checa(
    'o empreendimento cadastrado vai junto',
    comEmp.profile.empreendimentos.length === 1 &&
      comEmp.profile.empreendimentos[0].titulo === 'Residencial Jardins'
  );
  await p.click('[data-acao="eliaRemoverItem"]');
  checa('remover item tira da lista', (await p.$$('[data-record="empreendimentos"]')).length === 0);

  console.log('\n-- Fluxo --');
  await p.click('nav [data-key="fluxo"]');
  checa('fluxo vazio começa com o modelo de 4 etapas', (await p.$$('.elia-node')).length === 4);
  await p.click('.elia-node[data-node="ia"]');
  checa('clicar seleciona a etapa', !!(await p.$('.elia-node.active[data-node="ia"]')));
  await p.selectOption('[data-node-type]', 'condition');
  await p.click('[data-acao="eliaAddNo"]');
  checa(
    'adicionar etapa cria e seleciona',
    (await p.$$('.elia-node')).length === 5 && !!(await p.$('.elia-node.active'))
  );
  await p.fill('[data-node-field="title"]', 'Tem renda?');
  await p.selectOption('[data-node-field="next"]', 'enviar');
  checa(
    'escolher o destino redesenha a conexão',
    (await p.$$eval('.elia-canvas svg path', l => l.length)) >= 4 &&
      /Tem renda\?/.test(await p.textContent('.elia-canvas'))
  );
  await p.fill('[data-simulation]', 'Quero saber do Jardins');
  await p.click('[data-acao="eliaSimular"]');
  await p.waitForTimeout(300);
  const traco = await p.textContent('[data-trace]');
  checa(
    'simular mostra o caminho e a resposta, como texto',
    /Responder com OpenAI/.test(traco) && /Olá! <img/.test(traco)
  );
  const sim = est.chamadas.find(c => c.action === 'simulate');
  checa(
    'a simulação leva a mensagem e o fluxo com a etapa nova',
    sim.message === 'Quero saber do Jardins' && sim.flow.length === 5
  );
  // arrastar o ponto de saída de "Responder com OpenAI" até "Encerrar fluxo"
  await p.click('.elia-node[data-node="ia"]');
  const porta = await p.$('.elia-port[data-port="next"]');
  const alvo = await p.$('.elia-node[data-node="fim"]');
  const pb = await porta.boundingBox();
  const ab = await alvo.boundingBox();
  await p.mouse.move(pb.x + pb.width / 2, pb.y + pb.height / 2);
  await p.mouse.down();
  await p.mouse.move(ab.x + 20, ab.y + 20, { steps: 6 });
  await p.mouse.up();
  await p.waitForTimeout(200);
  checa(
    'arrastar a saída até outra etapa liga as duas',
    /Conexão criada/.test(await p.textContent('[data-el-status]'))
  );
  checa('e o destino aparece no campo da etapa', (await p.inputValue('[data-node-field="next"]')) === 'fim');
  await p.click(
    '.elia-node:not([data-node="entrada"]):not([data-node="ia"]):not([data-node="enviar"]):not([data-node="fim"])'
  );
  await p.click('[data-acao="eliaRemoverNo"]');
  checa('excluir etapa', (await p.$$('.elia-node')).length === 4);

  console.log('\n-- Verificar qualificação --');
  await p.selectOption('[data-node-type]', 'qualification');
  await p.click('[data-acao="eliaAddNo"]');
  checa(
    'a etapa nova já vem com as saídas: completo -> fila; faltando -> continua com a ELIA',
    (await p.inputValue('[data-node-field="next"]')) === '@fila' &&
      (await p.inputValue('[data-node-field="other"]')) === '@continuar'
  );
  const textoNo = await p.textContent('.elia-node.active');
  checa(
    'o quadro mostra as duas saídas na etapa',
    /fila de distribuição/.test(textoNo) && /continua com a ELIA/.test(textoNo),
    textoNo
  );
  checa(
    'as opções aparecem por extenso nos campos',
    /Enviar para a fila de distribuição/.test(await p.textContent('[data-node-field="next"]')) &&
      /Continuar com a ELIA até qualificar/.test(await p.textContent('[data-node-field="other"]'))
  );
  await p.check('[data-qualification-field="renda"]');
  await p.click('[data-acao="eliaSalvar"]');
  await p.waitForTimeout(300);
  const fq = est.chamadas
    .filter(c => c.action === 'save')
    .pop()
    .flow.find(n => n.type === 'qualification');
  checa(
    'salvar leva as saídas e os dados exigidos',
    !!fq && fq.next === '@fila' && fq.other === '@continuar' && fq.fields.join() === 'renda'
  );

  console.log('\n-- Quadro do fluxo ocupa a área toda --');
  await p.setViewportSize({ width: 2600, height: 1300 });
  await p.waitForTimeout(300);
  const med = await p.evaluate(() => {
    const a = document.querySelector('.elia-scroll');
    const c = document.querySelector('.elia-canvas');
    return {
      area: a.clientWidth,
      quadro: c.clientWidth,
      svg: Number(c.querySelector('svg').getAttribute('width'))
    };
  });
  checa(
    'em tela grande, o quadro acompanha a largura (sem faixa branca)',
    med.quadro >= med.area && med.svg === med.quadro,
    JSON.stringify(med)
  );
  const no = await p.$('.elia-node.active');
  const nb = await no.boundingBox();
  await p.mouse.move(nb.x + 30, nb.y + 20);
  await p.mouse.down();
  await p.mouse.move(nb.x + 30 + 700, nb.y + 20 + 50, { steps: 8 });
  await p.mouse.up();
  await p.waitForTimeout(200);
  const x = await p.evaluate(() => parseFloat(document.querySelector('.elia-node.active').style.left));
  checa('dá para arrastar a etapa além do antigo limite de 1220 px', x > 1220, String(x));
  await p.setViewportSize({ width: 1400, height: 950 });
  await p.waitForTimeout(200);

  console.log('\n-- Campanhas --');
  await p.click('nav [data-key="campanhas"]');
  await p.evaluate(() => {
    window.prompt = () => 'Formulário do site, 22/11';
  });
  await p.click('[data-acao="eliaBuscarContatos"]');
  await p.waitForTimeout(300);
  checa('contato sem consentimento não pode ser marcado', await p.isDisabled('[data-recipient="c2"]'));
  checa(
    'telefone da lista fica fosco (LGPD)',
    (await p.$$eval('[data-contacts] .lgpd', l => l.map(x => x.textContent))).includes('(98) 98123-4567')
  );
  await p.click('[data-acao="eliaConsentimento"][data-id="c2"]');
  await p.waitForTimeout(300);
  const cons = est.chamadas.find(c => c.action === 'consent');
  checa(
    'registrar consentimento pede e manda a origem',
    cons && cons.id === 'c2' && cons.granted === true && /Formulário do site/.test(cons.evidence)
  );
  await p.check('[data-recipient="c1"]');
  checa('conta os selecionados', /1 selecionados/.test(await p.textContent('[data-recipient-count]')));
  await p.fill('[data-draft="title"]', 'Lançamento');
  await p.fill('[data-draft="message"]', 'Olá, {{nome}}!');
  await p.click('[data-acao="eliaEnfileirar"]');
  await p.waitForTimeout(400);
  const camp = est.chamadas.find(c => c.action === 'campaign');
  checa(
    'enfileirar manda título, texto e os contatos',
    camp && camp.title === 'Lançamento' && camp.message === 'Olá, {{nome}}!' && camp.ids.join() === 'c1'
  );
  await p.click('[data-acao="eliaVerDestinatarios"]');
  await p.waitForTimeout(300);
  checa(
    'ver destinatários lista o resultado',
    /Joana <img/.test(await p.textContent('[data-campaign="cp1"] [data-results]'))
  );
  checa('nenhuma carga de XSS executou', (await p.evaluate(() => window.__XSS || 0)) === 0);
  await b.close();
  todos.push(...erros);

  process.exit(resumo(todos) ? 1 : 0);
})().catch(e => {
  console.error(e);
  process.exit(1);
});
