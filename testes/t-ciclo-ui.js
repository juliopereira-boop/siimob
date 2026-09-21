const { abrir, checa, resumo } = require('./comum');

(async()=>{
  const {b,p,erros}=await abrir('configuracoes.html',{modulos:['PRE_ANALISE']});
  console.log('\n== CONFIGURAÇÕES NOMEADAS DO CICLO ==');
  await p.evaluate(()=>openCfgView('ciclo-pa'));
  await p.waitForTimeout(500);
  checa('lista as configurações salvas',await p.locator('.ciclo-config').count()===2);
  checa('identifica visualmente a configuração ativa',await p.locator('.ciclo-status',{hasText:'Ativa'}).count()===1);
  checa('empresa é uma seleção única',await p.locator('#ciclo-empresa').count()===1);
  checa('usuário correspondente é uma seleção única',await p.locator('#ciclo-corr').count()===1);
  checa('analistas são caixas de seleção em lote',await p.locator('#ciclo-analistas-grid input[type=checkbox]').count()===2);

  await p.getByRole('button',{name:'Selecionar visíveis'}).click();
  checa('selecionar em lote marca todos os analistas',await p.locator('#ciclo-analistas-grid input:checked').count()===2);
  checa('contador acompanha a seleção',await p.locator('#ciclo-count').textContent()==='2 selecionado(s)');

  await p.locator('.ciclo-config',{hasText:'contingência'}).click();
  checa('configuração inativa oferece ativação',await p.getByRole('button',{name:'Ativar configuração'}).count()===1);
  await p.getByRole('button',{name:'Ativar configuração'}).click();
  const posts=await p.evaluate(()=>window.__POSTS);
  checa('ativação usa a RPC exclusiva',posts.some(x=>x.url.includes('/rpc/a1_pa_ciclo_ativar')));
  checa('nenhum erro de JavaScript',erros.length===0,erros.join(' | '));
  await b.close();
  process.exit(resumo(erros));
})();
