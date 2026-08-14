# Requisições de exemplo

Coleção `.http` (formato REST Client) cobrindo os fluxos principais da API.

## Como usar

1. **VS Code**: instale a extensão [REST Client](https://marketplace.visualstudio.com/items?itemName=humao.rest-client) (`humao.rest-client`) e abra `wagering.http` — cada bloco ganha um link "Send Request".
   **IntelliJ/WebStorm**: suporte nativo a `.http`, basta abrir o arquivo.
2. Suba as dependências (Postgres + SQS local via LocalStack): `docker-compose up -d`.
3. Copie `.env.example` para `.env` e ajuste se necessário.
4. Rode as migrations: `bun run migration:run`.
5. Suba a API: `bun --watch src/main.ts` (ou `bun run dev`).
6. Execute as requisições de `wagering.http` na ordem em que aparecem — os comentários indicam onde copiar valores da resposta (`id`, `transactionId`, `nextCursor`) para as variáveis de arquivo (`@walletId`, `@transactionId`, etc.) usadas nas requisições seguintes.
