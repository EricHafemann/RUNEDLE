# X1 ao vivo — configuração do Supabase

O X1 usa um projeto do [Supabase](https://supabase.com) (plano grátis) para:

- guardar as salas e o progresso dos jogadores, com atualização em tempo real;
- conferir os palpites **no servidor**, numa Edge Function. O navegador nunca recebe o campeão secreto antes de acertar.

A URL do projeto e a chave *publishable* ficam em [`js/config.js`](../js/config.js). Elas são públicas por natureza: só permitem o que as regras do banco liberam. **Nunca** coloque a chave *secret* / *service_role* no site.

## 1. Banco de dados

1. No painel do Supabase, abra **SQL Editor → New query**.
2. Cole o conteúdo de [`schema.sql`](schema.sql) e clique em **Run**.

Isso cria as tabelas `x1_rooms`, `x1_players`, `x1_secrets` e `x1_tokens`, liga a segurança (RLS), libera só a leitura de salas e jogadores e ativa o tempo real.

## 2. Função do servidor

### Pelo painel (sem instalar nada)

1. Abra **Edge Functions → Deploy a new function → Via Editor**.
2. Nome da função: **`x1`**.
3. Apague o código de exemplo e cole todo o conteúdo de [`x1-arquivo-unico.ts`](x1-arquivo-unico.ts).
4. Clique em **Deploy function**.
5. Na página da função, abra **Details** e **desligue** a opção **Verify JWT** (ou *Enforce JWT verification*) e salve. A própria função confere quem é cada jogador.

### Pela linha de comando

```bash
npx supabase login
npx supabase link --project-ref <id-do-projeto>
npx supabase functions deploy x1 --no-verify-jwt
```

## 3. Testar

Abra o site em `#x1`, crie uma sala e entre com o código em outro navegador (ou no celular).

## Manutenção

- Mudou campeões ou falas em `js/data.js`? Rode `node tools/build-x1-data.mjs` e publique a função de novo.
- Salas com mais de 1 dia são apagadas automaticamente sempre que alguém cria uma sala nova.
- No plano grátis, o projeto é **pausado depois de 1 semana sem uso**. Para reativar, abra o painel do Supabase e clique em **Restore project**.
