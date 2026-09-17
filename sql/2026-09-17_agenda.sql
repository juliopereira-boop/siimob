-- ══════════════════════════════════════════════════════════════════════════════
-- a1_agenda — cada pessoa com a sua agenda
-- ══════════════════════════════════════════════════════════════════════════════
--
-- POR QUE ESTE ARQUIVO EXISTE
-- O calendário do cabeçalho só sabia mostrar o que o Repasse já guardava:
-- entrevista marcada e vencimento de avaliação. Não havia como MARCAR nada. O
-- dono pediu: "essa agenda precisa ser funcional... a agenda ou tarefa criada
-- tem data, e essas datas entram no calendário, fica marcado".
--
-- Uma tabela, dois usos. Compromisso (tem hora, é um encontro) e tarefa (tem
-- prazo, é uma coisa a fazer) são a mesma linha com `tipo` diferente — porque
-- os dois ocupam o mesmo dia no calendário e quem olha quer ver os dois juntos.
-- Duas tabelas dariam duas consultas, dois formatos e duas chances de divergir.
--
-- A AGENDA É DA PESSOA, e é isso que a política diz: cada um vê e mexe no que é
-- seu. O gestor NÃO enxerga a agenda alheia — agenda tem almoço, médico e
-- conversa que não é da empresa. Quem precisa marcar PARA outro usa
-- `para_ator`, e aí o compromisso aparece para os dois.
--
-- O VÍNCULO COM O PROCESSO é opcional e frouxo de propósito: `caso_id` aponta
-- para a1_cases, `pre_analise_id` e `comercial_id` para as tabelas dos módulos
-- novos, e todos podem ser nulos. Compromisso que não é de processo nenhum —
-- uma reunião de equipe — é compromisso do mesmo jeito.
--
-- SEGURO DE RODAR DUAS VEZES.
begin;

create table if not exists public.a1_agenda (
  id            uuid primary key default gen_random_uuid(),
  tenant_id     uuid not null references public.a1_tenants(id) on delete cascade,

  -- De quem é. `dono` é quem criou; `para_ator` é para quem foi marcado, e
  -- quando os dois diferem o compromisso aparece para ambos.
  dono          uuid not null,
  para_ator     uuid,

  tipo          text not null default 'compromisso'
                check (tipo in ('compromisso','tarefa')),
  titulo        text not null,
  descricao     text,
  local         text,

  -- A data é o que entra no calendário, e por isso ela é `date` e não
  -- `timestamptz`: o dia de um compromisso não muda com o fuso de quem olha.
  -- A hora vai separada e pode faltar — tarefa costuma ter prazo, não horário.
  data          date not null,
  hora_inicio   time,
  hora_fim      time,

  -- Onde ele se encaixa no sistema. Todos opcionais.
  caso_id        uuid references public.a1_cases(id) on delete cascade,
  pre_analise_id uuid,
  comercial_id   uuid,

  concluido_em  timestamptz,
  cor           text,
  criado_em     timestamptz not null default now(),
  atualizado_em timestamptz not null default now()
);

-- O calendário sempre pergunta por INTERVALO DE DATA dentro de um cliente. É
-- essa consulta que o índice precisa servir; sem ele, cada abertura do
-- calendário varre a tabela inteira.
create index if not exists a1_agenda_data_idx on public.a1_agenda (tenant_id, data);
create index if not exists a1_agenda_dono_idx on public.a1_agenda (tenant_id, dono, data);
create index if not exists a1_agenda_caso_idx on public.a1_agenda (caso_id) where caso_id is not null;

alter table public.a1_agenda enable row level security;

-- ── Quem vê o quê ───────────────────────────────────────────────────────────
-- `(select ...)` em volta de cada função de identidade NÃO é enfeite: solta,
-- uma função STABLE de zero argumentos é reavaliada POR LINHA dentro da
-- política. Foi assim que a1_cases levou 1002ms com 235 linhas e devolveu 500
-- por timeout para uma usuária real. Entre parênteses, vira InitPlan e é
-- avaliada uma vez por consulta.
drop policy if exists a1_agenda_ler on public.a1_agenda;
create policy a1_agenda_ler on public.a1_agenda
  for select to anon, authenticated
  using (
    tenant_id = (select a1_tenant())
    and ( dono = (select a1_ator()) or para_ator = (select a1_ator())
          or dono = (select a1_usuario()) or para_ator = (select a1_usuario()) )
  );

-- Criar: só no próprio cliente, e só em nome de si mesmo. `dono` vindo da tela
-- seria a porta para marcar compromisso na agenda dos outros.
drop policy if exists a1_agenda_criar on public.a1_agenda;
create policy a1_agenda_criar on public.a1_agenda
  for insert to anon, authenticated
  with check (
    tenant_id = (select a1_tenant())
    and dono in ((select a1_ator()), (select a1_usuario()))
  );

drop policy if exists a1_agenda_editar on public.a1_agenda;
create policy a1_agenda_editar on public.a1_agenda
  for update to anon, authenticated
  using (
    tenant_id = (select a1_tenant())
    and ( dono = (select a1_ator()) or dono = (select a1_usuario())
          or para_ator = (select a1_ator()) or para_ator = (select a1_usuario()) )
  )
  with check (
    tenant_id = (select a1_tenant())
    and dono in ((select a1_ator()), (select a1_usuario()))
  );

-- Apagar é só do dono. Quem recebeu um compromisso pode concluí-lo (update),
-- não sumir com ele da agenda de quem marcou.
drop policy if exists a1_agenda_apagar on public.a1_agenda;
create policy a1_agenda_apagar on public.a1_agenda
  for delete to anon, authenticated
  using (
    tenant_id = (select a1_tenant())
    and ( dono = (select a1_ator()) or dono = (select a1_usuario()) )
  );

grant select, insert, update, delete on public.a1_agenda to anon, authenticated;

-- `atualizado_em` escrito pelo banco, não pela tela: carimbo que o navegador
-- controla não serve para auditar nada.
create or replace function public.a1_agenda_toca()
returns trigger language plpgsql as $$
begin new.atualizado_em := now(); return new; end $$;

drop trigger if exists a1_agenda_toca_t on public.a1_agenda;
create trigger a1_agenda_toca_t before update on public.a1_agenda
  for each row execute function public.a1_agenda_toca();

commit;

-- ── CONFERÊNCIA ──────────────────────────────────────────────────────────────
-- 1. Marcar um compromisso para hoje:
--    insert into a1_agenda (tenant_id, dono, tipo, titulo, data, hora_inicio)
--    values (a1_tenant(), a1_ator(), 'compromisso', 'Reunião', current_date, '14:00')
--    returning id, data;
--
-- 2. Ele aparece para quem criou:
--    select titulo, data, hora_inicio from a1_agenda where data = current_date;
--
-- 3. E NÃO aparece para outra pessoa. Com outra sessão, a mesma consulta tem de
--    voltar vazia — inclusive para o gestor. Se o gestor vir, a política está
--    errada: agenda não é do cliente, é da pessoa.
--
-- 4. Ninguém marca na agenda alheia:
--    insert into a1_agenda (tenant_id, dono, tipo, titulo, data)
--    values (a1_tenant(), '<uuid de outra pessoa>', 'tarefa', 'x', current_date);
--    -- deve falhar por política
