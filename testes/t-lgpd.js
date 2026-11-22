// LGPD: dado pessoal fosco até o mouse chegar.
//
// O PEDIDO DO DONO
//   "devido a LGPD, dados sensíveis ficam embaçados, somente aparece se estiver
//    com o mouse em cima (...) vale para o sistema inteiro: telefone, cpf,
//    e-mail, endereço"
//
// O QUE ESTE ARQUIVO PROVA
// 1. Em tela interna (Central de atendimento e funil de Leads), telefone,
//    e-mail, CPF e endereço viram <span class="lgpd"> embaçado, com o mesmo
//    texto; passar o mouse tira o embaçado.
// 2. O que não é dado pessoal (valor, data, protocolo, nome) não é tocado.
// 3. Campo de telefone/e-mail fica fosco sem foco e nítido com foco.
// 4. Texto que entra depois (lista ao vivo) também é protegido.
// 5. O site público não carrega a proteção (lá a pessoa digita o próprio dado).
// 6. Nada vira HTML: a carga de XSS plantada no nome não executa.
const { abrir, checa, resumo } = require('./comum');

const XSS = '<img src=x onerror="window.__XSS=(window.__XSS||0)+1">';
const borrado = (p, sel) =>
  p.evaluate(s => {
    const el = document.querySelector(s);
    return !!el && /blur\(/.test(getComputedStyle(el).filter);
  }, sel);

(async () => {
  const todos = [];
  const agora = new Date().toISOString();

  console.log('== Central de atendimento ==');
  {
    const est = {
      conversas: [
        {
          id: 'a1',
          case_id: 'c1',
          canal: 'meta',
          status: 'aberta',
          pendente: true,
          ultima_em: agora,
          ultima_previa: 'Novo lead',
          versao: 1
        }
      ],
      leads: [
        {
          id: 'c1',
          client_name: 'Fernanda ' + XSS,
          client_phone: '(98) 98123-4567',
          client_email: 'fernanda@exemplo.com',
          partner_name: 'Meta',
          stage_name: 'Lead Recebido',
          payload: {
            integracao: {
              dados: {
                respostas: [
                  { pergunta: 'Endereço', resposta: 'Rua das Flores, 123' },
                  { pergunta: 'CPF', resposta: '123.456.789-09' },
                  { pergunta: 'Renda', resposta: 'R$ 7.500,00' }
                ]
              }
            }
          }
        }
      ],
      msgs: [
        {
          id: 'm1',
          autor_tipo: 'sistema',
          tipo: 'evento',
          corpo: 'Lead recebido. WhatsApp 98 99999 0001, protocolo 29035609222727382',
          criado_em: agora
        }
      ]
    };
    const { b, p, erros } = await abrir('thecred/atendimento', {
      modulos: ['crm', 'ATENDIMENTO'],
      antes: url => {
        if (url.includes('/rest/v1/a1_atendimentos')) return est.conversas;
        if (url.includes('/rest/v1/a1_atendimento_mensagens')) return est.msgs;
        if (url.includes('/rest/v1/a1_cases') && url.includes('id=in.')) return est.leads;
        if (url.includes('/rpc/a1_roleta_proximo_nome')) return null;
        return undefined;
      }
    });
    await p.click('.at-item[data-id="a1"]');
    await p.waitForTimeout(500);
    const marcados = await p.$$eval('#at-lead .lgpd, #at-msgs .lgpd', l => l.map(x => x.textContent));
    checa(
      'telefone, e-mail, CPF e endereço do painel ficam marcados',
      ['(98) 98123-4567', 'fernanda@exemplo.com', '123.456.789-09', 'Rua das Flores, 123'].every(x =>
        marcados.includes(x)
      ),
      marcados.join(' | ')
    );
    checa('o telefone dentro de uma frase também', marcados.includes('98 99999 0001'), marcados.join(' | '));
    checa(
      'valor, protocolo e nome não são tocados',
      !marcados.some(x => /7\.500|29035609222727382|Fernanda/.test(x)),
      marcados.join(' | ')
    );
    checa(
      'o texto da tela continua o mesmo',
      /WhatsApp 98 99999 0001, protocolo/.test(await p.textContent('#at-msgs'))
    );
    const sel = '#at-lead .lgpd';
    checa('o dado aparece embaçado', await borrado(p, sel));
    await p.hover(sel);
    await p.waitForTimeout(250);
    checa('com o mouse em cima, fica nítido', !(await borrado(p, sel)));
    await p.mouse.move(5, 5);
    await p.waitForTimeout(250);
    checa('tirou o mouse, embaça de novo', await borrado(p, sel));

    console.log('\n-- Ao vivo --');
    est.conversas = [
      {
        id: 'a2',
        case_id: 'c2',
        canal: 'whatsapp',
        status: 'aberta',
        pendente: true,
        ultima_em: agora,
        ultima_previa: 'Me liga no (98) 98888-7777',
        versao: 1
      },
      ...est.conversas
    ];
    est.leads = [...est.leads, { id: 'c2', client_name: 'Novo', payload: {} }];
    await p.evaluate(() => document.dispatchEvent(new Event('visibilitychange')));
    await p.waitForTimeout(700);
    checa(
      'telefone que chega depois, na lista ao vivo, também fica fosco',
      (await p.$$eval('.at-item[data-id="a2"] .lgpd', l => l.map(x => x.textContent))).includes(
        '(98) 98888-7777'
      )
    );
    checa('nenhuma carga de XSS executou', (await p.evaluate(() => window.__XSS || 0)) === 0);
    await b.close();
    todos.push(...erros);
  }

  console.log('\n== Funil de Leads: campo de telefone ==');
  {
    const { b, p, erros } = await abrir('thecred/crm', { modulos: ['crm'] });
    await p.evaluate(() => {
      const i = document.createElement('input');
      i.type = 'tel';
      i.id = 'teste-tel';
      i.value = '98999990000';
      document.body.prepend(i);
      const e = document.createElement('input');
      e.id = 'lead-email';
      e.value = 'a@b.com';
      document.body.prepend(e);
      const n = document.createElement('input');
      n.id = 'lead-nome';
      n.value = 'Maria';
      document.body.prepend(n);
    });
    await p.mouse.move(900, 700);
    await p.waitForTimeout(250);
    checa('campo de telefone fica fosco sem foco', await borrado(p, '#teste-tel'));
    checa('campo de e-mail pelo id também', await borrado(p, '#lead-email'));
    checa('campo de nome não', !(await borrado(p, '#lead-nome')));
    await p.focus('#teste-tel');
    await p.waitForTimeout(250);
    checa('com o foco, fica nítido para digitar', !(await borrado(p, '#teste-tel')));
    await b.close();
    todos.push(...erros);
  }

  console.log('\n== Site público ==');
  {
    const { b, p, erros } = await abrir('contato');
    checa('o site público não carrega a proteção', !(await p.$('#lgpd-estilo')));
    await b.close();
    todos.push(...erros);
  }

  process.exit(resumo(todos) ? 1 : 0);
})().catch(e => {
  console.error(e);
  process.exit(1);
});
