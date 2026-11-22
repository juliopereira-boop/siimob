export const nodeTypes = [
  'trigger',
  'ai',
  'message',
  'condition',
  'routes',
  'qualification',
  'roulette',
  'wait',
  'handoff',
  'agenda',
  'end'
];
export const qualificationFields = [
  'nome',
  'telefone',
  'email',
  'cpf',
  'empreendimento',
  'renda',
  'cidade',
  'tipo_imovel',
  'quartos',
  'orcamento',
  'prazo',
  'observacoes'
];

export function validateFlow(nodes) {
  if (!Array.isArray(nodes) || nodes.length < 1 || nodes.length > 30) throw Error('Fluxo inválido.');
  const byId = new Map();
  for (const node of nodes) {
    if (
      !node ||
      !/^[a-zA-Z0-9_-]{1,64}$/.test(node.id) ||
      byId.has(node.id) ||
      !nodeTypes.includes(node.type) ||
      typeof node.text !== 'string' ||
      node.text.length > 4000
    )
      throw Error('Nó inválido.');
    if (node.type === 'wait' && (!Number.isInteger(node.minutes) || node.minutes < 1 || node.minutes > 43200))
      throw Error('Informe um tempo de espera entre 1 e 43200 minutos.');
    if (node.type === 'condition' && !node.text.trim()) throw Error('Informe uma condição.');
    if (
      node.type === 'routes' &&
      (!Array.isArray(node.routes) ||
        !node.routes.length ||
        node.routes.length > 20 ||
        node.routes.some(
          route =>
            !route ||
            typeof route.text !== 'string' ||
            !route.text.trim() ||
            route.text.length > 200 ||
            typeof route.next !== 'string'
        ))
    )
      throw Error('Configure os caminhos da etapa.');
    if (
      ['qualification', 'roulette'].includes(node.type) &&
      (!Array.isArray(node.fields) ||
        !node.fields.length ||
        node.fields.some(field => !qualificationFields.includes(field)) ||
        new Set(node.fields).size !== node.fields.length)
    )
      throw Error('Selecione os dados obrigatórios da qualificação.');
    byId.set(node.id, node);
  }
  const starts = nodes.filter(node => node.type === 'trigger');
  if (starts.length !== 1) throw Error('O fluxo precisa de um gatilho.');
  const visiting = new Set();
  const visited = new Set();
  function visit(id) {
    if (!id || visiting.has(id) || !byId.has(id)) throw Error('Conexão inválida ou ciclo no fluxo.');
    if (visited.has(id)) return;
    const node = byId.get(id);
    visiting.add(id);
    if (!['end', 'handoff', 'roulette'].includes(node.type)) visit(node.next);
    if (node.type === 'condition' || node.type === 'qualification') visit(node.other);
    if (node.type === 'routes') node.routes.forEach(route => visit(route.next));
    visiting.delete(id);
    visited.add(id);
  }
  visit(starts[0].id);
  if (visited.size !== byId.size) throw Error('Conecte todos os nós ao gatilho.');
  return { byId, start: starts[0].id };
}

export async function runFlow(nodes, context, actions) {
  const { byId, start } = validateFlow(nodes);
  let id = context.resume || start;
  let output = context.output || '';
  for (let steps = 0; steps < nodes.length; steps++) {
    const node = byId.get(id);
    if (!node) throw Error('Fluxo alterado.');
    const render = text =>
      text.replace(
        /\{\{(nome|mensagem|resposta)\}\}/g,
        (_, key) => ({ nome: context.name, mensagem: context.message, resposta: output })[key] || ''
      );
    if (node.type === 'end') return output;
    if (node.type === 'ai') output = await actions.ai(render(node.text));
    if (node.type === 'message') await actions.send(render(node.text));
    if (node.type === 'agenda') output = await actions.agenda(render(node.text));
    if (node.type === 'handoff') return await actions.handoff(render(node.text));
    if (node.type === 'roulette') return await actions.roulette(node.id);
    if (node.type === 'wait') return await actions.wait(node.next, node.minutes, output);
    if (node.type === 'routes') {
      const message = context.message.toLocaleLowerCase('pt-BR');
      id =
        node.routes.find(route => message.includes(route.text.toLocaleLowerCase('pt-BR')))?.next || node.next;
    } else if (node.type === 'qualification') {
      const data = context.qualification || {};
      id = node.fields.every(field => typeof data[field] === 'string' && data[field].trim())
        ? node.next
        : node.other;
    } else if (node.type === 'condition') {
      id = context.message.toLocaleLowerCase('pt-BR').includes(node.text.toLocaleLowerCase('pt-BR'))
        ? node.next
        : node.other;
    } else {
      id = node.next;
    }
  }
  throw Error('Limite de passos do fluxo.');
}
