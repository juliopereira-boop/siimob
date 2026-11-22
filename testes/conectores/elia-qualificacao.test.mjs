import test from 'node:test';
import assert from 'node:assert/strict';
import { validarQualificacao } from '../../supabase/functions/elia/qualificacao.mjs';

test('aceita apenas campos apoiados em fala do próprio lead', () => {
  const conversas = [{ autor_tipo:'ia', corpo:'Você quer o Jardins?' }, { autor_tipo:'lead', corpo:'Minha renda é 2500 e quero 2 quartos.' }];
  const proposta = JSON.stringify({ renda:{valor:'2500',evidencia:'renda é 2500'}, quartos:{valor:'2',evidencia:'2 quartos'}, empreendimento:{valor:'Jardins',evidencia:'Jardins'}, inesperado:{valor:'x',evidencia:'renda'} });
  assert.deepEqual(validarQualificacao(proposta, conversas),{renda:'2500',quartos:'2'});
});
test('ignora conteúdo inválido, valores sem evidência e formatos não permitidos',()=>{
  assert.deepEqual(validarQualificacao('não é json',[]),{});
  assert.deepEqual(validarQualificacao(JSON.stringify({renda:{valor:'2500',evidencia:'não disse'}}),[{autor_tipo:'lead',corpo:'Oi'}]),{});
});
test('contatos só aceitam o valor literalmente informado',()=>{
  const mensagens=[{autor_tipo:'lead',corpo:'Meu e-mail é ana@example.com e CPF 123.456.789-00'}];
  const dados=JSON.stringify({email:{valor:'ana@example.com',evidencia:'ana@example.com'},cpf:{valor:'12345678900',evidencia:'123.456.789-00'},nome:{valor:'Ana Silva',evidencia:'ana@example.com'}});
  assert.deepEqual(validarQualificacao(dados,mensagens),{email:'ana@example.com',cpf:'12345678900'});
});
