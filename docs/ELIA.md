# ELIA na Central de Atendimento

Gestores e proprietários com a licença **ATENDIMENTO** encontram a ELIA em **Configurações → Integrações**. O perfil, a base de conhecimento, o fluxo, as campanhas e o Google Agenda ficam isolados por empresa. O agente começa desativado.

## Configuração do ambiente

1. Aplique `database/migrations/2026-11-22_elia.sql` depois da migração de conectores. Publique `supabase/functions/elia` com o bundle contendo os imports relativos de `atendimento-conectores` e com `verify_jwt=false`. O endpoint usa sessão do SIIMOB nas operações do painel, estado de uso único no OAuth e um segredo próprio no worker.
2. Reutilize `SIIMOB_EVOLUTION_URL`, `SIIMOB_EVOLUTION_KEY` e a chave OpenAI da empresa ou `SIIMOB_OPENAI_API_KEY`. Use `SIIMOB_ELIA_ORIGIN` quando o domínio do painel for diferente de `https://siimob.com`.
3. Gere um segredo aleatório para `SIIMOB_ELIA_WORKER_SECRET`. Cadastre-o também no Vault como `elia_worker_secret`, e a URL base do Supabase, sem barra final, como `elia_project_url`. Com Cron e pg_net habilitados, agende o worker:

   ```sql
   select cron.schedule('elia-processar-fila', '10 seconds', $$
     select net.http_post(
       url := (select decrypted_secret from vault.decrypted_secrets where name = 'elia_project_url')
         || '/functions/v1/elia?worker=1',
       headers := jsonb_build_object('Authorization', 'Bearer ' ||
         (select decrypted_secret from vault.decrypted_secrets where name = 'elia_worker_secret')),
       timeout_milliseconds := 3000
     );
   $$);
   ```

4. Para Google Agenda, habilite Calendar API e crie um cliente OAuth do tipo aplicativo web. Cadastre `https://<projeto>.supabase.co/functions/v1/elia` como URI de retorno. Configure `SIIMOB_GOOGLE_CLIENT_ID`, `SIIMOB_GOOGLE_CLIENT_SECRET` e `SIIMOB_ELIA_ENCRYPTION_KEY` (32 bytes em hexadecimal). Em **Google Agenda**, conecte a conta e selecione a agenda pelo ID, ou mantenha `primary`. A listagem consulta o Google diretamente, e os agendamentos feitos no SIIMOB são criados na agenda selecionada.
5. Pareie um WhatsApp de teste. Salve e simule um fluxo antes de ativá-lo. A simulação pode chamar OpenAI, mas não envia mensagens nem agenda eventos. Use contatos com consentimento explícito para testar campanhas.

## Operação

- Editor visual com nós arrastáveis, ramificações e simulação. Conecte os nós no painel do nó selecionado. Os campos de texto aceitam `{{nome}}`, `{{mensagem}}` e `{{resposta}}`. No nó de agenda, informe `title`, `start` e `end` em JSON com horários ISO e fuso. A saída contém o link do evento quando fornecido pelo Google.
- Follow-up usa o nó Aguardar, cancela a execução quando a conversa muda e exige consentimento para iniciar conversa fora da janela de resposta.
- O Google Agenda pode disparar um lembrete por WhatsApp para compromissos criados pela ELIA quando há consentimento. Antes de enviar, o worker consulta o horário atual do compromisso.
- As campanhas usam texto e um anexo JPG, PNG, WebP ou PDF de até 5 MB por mensagem. Ao registrar consentimento, indique de onde ele veio. A autorização é vinculada ao telefone registrado. A fila reavalia o consentimento e os limites da Evolution antes do envio. Em caso de resultado incerto, a fila registra falha para revisão em vez de reenviar automaticamente.
- O status indica que a Evolution aceitou o envio. A confirmação de entrega e leitura é independente desse status.
