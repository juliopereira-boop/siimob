const campos = ['nome','email','cpf','empreendimento','renda','cidade','tipo_imovel','quartos','orcamento','prazo','observacoes'];

// A IA precisa citar texto escrito pelo próprio lead para cada informação.
export function validarQualificacao(resposta, mensagens) {
  let proposta;
  try { proposta = JSON.parse(String(resposta).replace(/^```(?:json)?\s*|\s*```$/g, '').trim()); }
  catch { return {}; }
  if (!proposta || typeof proposta !== 'object' || Array.isArray(proposta)) return {};
  const falas = mensagens.filter(m => m.autor_tipo === 'lead' && typeof m.corpo === 'string').map(m => m.corpo.toLocaleLowerCase('pt-BR'));
  const dados = {};
  for (const campo of campos) {
    const item = proposta[campo];
    if (!item || typeof item.valor !== 'string' || typeof item.evidencia !== 'string') continue;
    const valor = item.valor.trim(), evidencia = item.evidencia.trim();
    if (!valor || valor.length > 500 || evidencia.length < 2 || evidencia.length > 500) continue;
    if (!falas.some(fala => fala.includes(evidencia.toLocaleLowerCase('pt-BR')))) continue;
    if (campo === 'nome' && valor.toLocaleLowerCase('pt-BR') !== evidencia.toLocaleLowerCase('pt-BR')) continue;
    if (campo === 'email' && (valor.toLowerCase() !== evidencia.toLowerCase() || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(valor))) continue;
    if (campo === 'cpf' && (valor.replace(/\D/g,'').length !== 11 || valor.replace(/\D/g,'') !== evidencia.replace(/\D/g,''))) continue;
    dados[campo] = valor;
  }
  return dados;
}
