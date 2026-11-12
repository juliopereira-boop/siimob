// Edge Function sa-proxy. A lógica está em nucleo.mjs (testada em Node por
// testes/t-sa-proxy.js); aqui só se liga o servidor com as variáveis do
// Supabase. SUPABASE_URL e SUPABASE_SERVICE_ROLE_KEY o Supabase já fornece.
// SA_ORIGENS (opcional) troca a lista de origens liberadas no CORS.
//
// Publicar com verify_jwt = false: a autenticação é a sessão do autenticador,
// conferida no banco a cada pedido.
import { criarTratador } from './nucleo.mjs';

Deno.serve(
  criarTratador({
    url: Deno.env.get('SUPABASE_URL') ?? '',
    chave: Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '',
    origens: Deno.env.get('SA_ORIGENS') ?? undefined
  })
);
