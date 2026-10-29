// ─── Datas no fuso de quem está usando ───────────────────────────────────────
//
// POR QUE ESTE ARQUIVO EXISTE
// `new Date().toISOString().slice(0, 10)` parece "hoje", mas é o dia em UTC. No
// Brasil (UTC-3), das 21h à meia-noite, ele já é amanhã: a Agenda abria com a
// data do dia seguinte, o painel do Registro contava o mês seguinte no último
// dia do mês, e o nome do CSV de Leads saía com a data errada. Tudo que precisa
// de "hoje" pergunta aqui.

// AAAA-MM-DD do dia local (o que a pessoa vê no relógio do computador).
function hojeISO(d = new Date()) {
  const p = n => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}
