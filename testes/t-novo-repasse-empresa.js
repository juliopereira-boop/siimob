// "Erro ao criar repasse" ao escolher a empresa antes da analista.
//
// O relato de produção (THE CRED, 02/10): a usuária abria Novo Repasse,
// escolhia a empresa correspondente, depois a analista, e o banco recusava com
// 400. O log do Postgres dizia o motivo inteiro:
//
//     invalid input syntax for type uuid: "DANIELE RODRIGUES"
//
// Em 11/09 os três vínculos (empresa, correspondente, analista) passaram a ser
// gravados por id. openNewCase() foi convertido; onNovoRepasseEmpresaChange(),
// que REMONTA a lista de analistas quando a empresa muda, não foi — continuou
// pondo o NOME no value das opções, e procurando a empresa pelo nome quando o
// seletor já entregava o id. Quem escolhia a analista sem mexer na empresa
// conseguia criar; quem escolhia a empresa primeiro, não.
//
// A suíte de vínculos não pegou porque setava .value direto no seletor, sem
// disparar o onchange: provava o caminho que funcionava e nunca o que quebrava.
// Aqui a troca é feita com selectOption, que dispara o evento de verdade.
const { abrir, checa, resumo } = require('./comum');

const UUID = /^[0-9a-f-]{8,}$|^p\d+$/i;   // ids reais são uuid; os do andaime são p2, p22...

async function corpoDoPost(p) {
  return p.evaluate(() => {
    const r = (window.__POSTS || []).filter(x => /\/a1_cases(\?|$)/.test(x.url) && x.m === 'POST');
    try { return r.length ? JSON.parse(r[r.length - 1].body) : null; } catch { return null; }
  });
}
async function opcoes(p, id) {
  return p.$$eval('#' + id + ' option', os => os.map(o => ({ v: o.value, t: o.textContent.trim() })));
}

(async () => {
  const todosErros = [];

  for (const pag of ['andamento.html', 'listagem.html', 'repasse.html']) {
    console.log(`\n${pag}: empresa escolhida antes da analista`);
    const { b, p, erros } = await abrir(pag);
    await p.evaluate(() => openNewCase());
    await p.waitForTimeout(600);

    // A troca de empresa feita como a pessoa faz: dispara o onchange.
    await p.selectOption('#n-partner', 'e1');
    await p.waitForTimeout(700);

    const ana = await opcoes(p, 'n-manager');
    const reais = ana.filter(o => o.v);
    checa('a lista de analistas é remontada para a empresa',
      reais.some(o => o.t.includes('João Analista')), JSON.stringify(ana));
    checa('e cada opção carrega o ID da analista, não o nome',
      reais.length > 0 && reais.every(o => UUID.test(o.v) && o.v !== o.t), JSON.stringify(reais));

    await p.selectOption('#n-manager', { label: 'João Analista' });
    await p.fill('#n-name', 'Cliente da Empresa');
    await p.evaluate(() => createCase());
    await p.waitForTimeout(700);

    const corpo = await corpoDoPost(p);
    checa('o POST leva analista_id = id da analista (era o nome, e o banco recusava)',
      !!corpo && corpo.analista_id === 'p2', JSON.stringify(corpo && { analista_id: corpo.analista_id }));
    checa('o POST leva empresa_id = id da empresa',
      !!corpo && corpo.empresa_id === 'e1', JSON.stringify(corpo && { empresa_id: corpo.empresa_id }));
    checa('e o nome continua indo em manager_name, que filtros e relatórios ainda leem',
      !!corpo && corpo.manager_name === 'João Analista', JSON.stringify(corpo && { manager_name: corpo.manager_name }));
    checa('nada de XSS', await p.evaluate(() => window.__XSS || 0) === 0);
    todosErros.push(...erros);
    await b.close();
  }

  console.log('\nCorrespondente (CCA): a empresa dele já vem escolhida');
  {
    const { b, p, erros } = await abrir('andamento.html');
    // O CCA não escolhe empresa: ela é fixada pela dele. O defeito aqui era o
    // mesmo, por outra porta — o seletor recebia o NOME num select cujos values
    // são ids, ficava vazio, e a lista de analistas saía com nomes.
    // Correspondente COM a permissão de criar: sem ela openNewCase() recusa e
    // o formulário nem abre — e a asserção passaria a medir a recusa, não o
    // vínculo. É a política do banco: cca e analista com criar_repasses.
    await p.evaluate(async () => {
      if (!G.empresasLoaded) await loadEmpresas();
      G.user = Object.assign({}, G.user, {
        role:'partner', type:'cca', permissions:{ criar_repasses:true },
        empresa_name: (G.empresas.find(e => e.id === 'e1') || {}).name || '' });
      if (typeof G.permsPorEtapa !== 'undefined') G.permsPorEtapa = null;
    });
    checa('o andaime: este correspondente pode criar repasse',
      await p.evaluate(() => podeCriarRepasse()) === true);
    await p.evaluate(() => openNewCase());
    await p.waitForTimeout(900);

    checa('a empresa do correspondente vem selecionada pelo id',
      await p.inputValue('#n-partner') === 'e1', await p.inputValue('#n-partner'));
    const reais = (await opcoes(p, 'n-manager')).filter(o => o.v);
    checa('e a lista de analistas dele também vem por id',
      reais.length > 0 && reais.every(o => UUID.test(o.v) && o.v !== o.t), JSON.stringify(reais));
    todosErros.push(...erros);
    await b.close();
  }

  process.exit(resumo(todosErros));
})();
