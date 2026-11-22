import assert from 'node:assert/strict';
import test from 'node:test';
import { runFlow, validateFlow } from '../../supabase/functions/elia/flow.mjs';

const nodes = [
  { id: 'start', type: 'trigger', text: '', next: 'if' },
  { id: 'if', type: 'condition', text: 'visita', next: 'ai', other: 'end' },
  { id: 'ai', type: 'ai', text: '{{mensagem}}', next: 'wait' },
  { id: 'wait', type: 'wait', text: '', minutes: 15, next: 'send' },
  { id: 'send', type: 'message', text: '{{nome}}: {{resposta}}', next: 'end' },
  { id: 'end', type: 'end', text: '' }
];

test('valida referências, ciclos e nós fora do fluxo', () => {
  assert.throws(() => validateFlow(nodes.map(n => (n.id === 'if' ? { ...n, next: 'start' } : n))), /ciclo/);
  assert.throws(() => validateFlow([...nodes, { id: 'loose', type: 'end', text: '' }]), /Conecte todos/);
  assert.throws(
    () => validateFlow(nodes.map(n => (n.id === 'wait' ? { ...n, minutes: 0 } : n))),
    /tempo de espera/
  );
});

test('decide pelo texto, aguarda e retoma sem repetir a OpenAI', async () => {
  const context = { name: 'Ana', message: 'Quero uma visita' };
  const sent = [];
  const checkpoint = await runFlow(nodes, context, {
    ai: text => {
      assert.equal(text, context.message);
      return 'Manhã ou tarde?';
    },
    wait: (resume, minutes, output) => ({ resume, minutes, output })
  });
  assert.deepEqual(checkpoint, { resume: 'send', minutes: 15, output: 'Manhã ou tarde?' });
  await runFlow(nodes, { ...context, ...checkpoint }, { send: text => sent.push(text) });
  assert.deepEqual(sent, ['Ana: Manhã ou tarde?']);
  assert.equal(await runFlow(nodes, { ...context, message: 'Olá' }, {}), '');
});

test('avança somente quando todos os dados exigidos estiverem preenchidos', async () => {
  const flow = [
    { id: 'start', type: 'trigger', text: '', next: 'qualificar' },
    {
      id: 'qualificar',
      type: 'qualification',
      text: '',
      fields: ['renda', 'empreendimento'],
      next: 'pronto',
      other: 'pendente'
    },
    { id: 'pronto', type: 'message', text: 'pronto', next: 'fim' },
    { id: 'pendente', type: 'message', text: 'pendente', next: 'fim' },
    { id: 'fim', type: 'end', text: '' }
  ];
  const saida = [];
  await runFlow(
    flow,
    { message: '', qualification: { renda: '2500', empreendimento: 'Jardins' } },
    { send: value => saida.push(value) }
  );
  await runFlow(
    flow,
    { message: '', qualification: { renda: '2500', empreendimento: ' ' } },
    { send: value => saida.push(value) }
  );
  assert.deepEqual(saida, ['pronto', 'pendente']);
  assert.throws(
    () => validateFlow(flow.map(n => (n.type === 'qualification' ? { ...n, fields: [] } : n))),
    /dados obrigatórios/
  );
  assert.throws(
    () => validateFlow(flow.map(n => (n.type === 'qualification' ? { ...n, fields: ['inexistente'] } : n))),
    /dados obrigatórios/
  );
});

test('roleta é uma etapa terminal e exige seleção dos campos', async () => {
  const flow = [
    { id: 'start', type: 'trigger', text: '', next: 'roleta' },
    { id: 'roleta', type: 'roulette', text: '', fields: ['renda'] }
  ];
  let chamado;
  await runFlow(
    flow,
    { message: '' },
    {
      roulette: id => {
        chamado = id;
      }
    }
  );
  assert.equal(chamado, 'roleta');
  assert.throws(() => validateFlow([flow[0], { ...flow[1], fields: [] }]), /dados obrigatórios/);
});

test('múltiplos caminhos seguem a primeira opção correspondente ou o padrão', async () => {
  const flow = [
    { id: 'start', type: 'trigger', text: '', next: 'routes' },
    {
      id: 'routes',
      type: 'routes',
      text: '',
      next: 'default',
      routes: [
        { text: 'alugar', next: 'rent' },
        { text: 'comprar', next: 'buy' }
      ]
    },
    { id: 'rent', type: 'message', text: 'aluguel', next: 'end' },
    { id: 'buy', type: 'message', text: 'compra', next: 'end' },
    { id: 'default', type: 'message', text: 'outro', next: 'end' },
    { id: 'end', type: 'end', text: '' }
  ];
  const sent = [];
  for (const message of ['quero alugar', 'quero comprar', 'oi'])
    await runFlow(flow, { message }, { send: value => sent.push(value) });
  assert.deepEqual(sent, ['aluguel', 'compra', 'outro']);
  assert.throws(
    () =>
      validateFlow(flow.map(n => (n.id === 'routes' ? { ...n, routes: [{ text: '', next: 'buy' }] } : n))),
    /caminhos/
  );
});
