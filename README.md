# Distributed Wagering Processor

Processador distribuído de transações de aposta com correção financeira sob entrega
at-least-once. API HTTP + consumer SQS + workers de background, arquitetura
hexagonal/DDD, PostgreSQL como fonte de verdade, SQS (LocalStack em dev/teste) como
canal de mensageria.

## Stack

- [Bun](https://bun.com) 1.3+ como runtime, gerenciador de pacotes e test runner
- TypeScript em modo estrito
- NestJS (camada HTTP e injeção de dependência)
- TypeORM + PostgreSQL
- AWS SDK v3 (`@aws-sdk/client-sqs`) + LocalStack para SQS em dev/teste
- [k6](https://k6.io) para o teste de carga (ferramenta externa, não é dependência do projeto)

## Setup

```bash
# 1. Instalar dependências
bun install

# 2. Copiar o exemplo de variáveis de ambiente
cp .env.example .env

# 3. Subir Postgres e LocalStack (dev)
docker compose up -d --wait

# 4. Rodar as migrations
bun run migration:run

# 5. Subir a API
bun run dev
```

A API sobe em `http://localhost:3000` por padrão (`PORT` no `.env`). Health checks
em `GET /health/live` e `GET /health/ready` não exigem autenticação.

### Rodando as outras roles

O mesmo `src/main.ts` seleciona o comportamento pela variável `APP_ROLE`:

```bash
# Consumer da fila wager-transactions.fifo (canal SQS alternativo ao HTTP)
APP_ROLE=consumer bun run src/main.ts

# Worker de background (publica a outbox em wager-events + reprocessa PENDING_REFERENCE)
APP_ROLE=worker bun run src/main.ts
```

Cada role lê as variáveis relevantes do `.env` — veja `.env.example` para a lista
completa (`SQS_QUEUE_URL`, `SQS_DLQ_URL`, `CONSUMER_NAME`, `EVENTS_QUEUE_URL`,
`OUTBOX_POLL_INTERVAL_MS`, `PENDING_REFERENCE_*`, etc.).

## Comandos

```bash
bun run typecheck          # tsc --noEmit
bun run lint                # eslint .

bun test                    # testes unitários (nenhuma infraestrutura externa)
bun run test:integration    # contra Postgres e LocalStack reais (docker-compose.test.yml)
bun run test:concurrency    # cenários de paralelismo real (barreira de largada) contra infra real
bun run test:load           # k6 contra uma instância local rodando (ver "Teste de carga" abaixo)

bun run migration:generate  # gera uma nova migration a partir das entidades TypeORM
bun run migration:run
bun run migration:revert
```

`test:integration` e `test:concurrency` sobem e derrubam `docker-compose.test.yml`
automaticamente (Postgres na porta 55432, LocalStack na 54566 — portas diferentes do
ambiente de dev, para nunca colidir). Não precisam de setup manual, mas exigem Docker
rodando.

## Exemplos executáveis

`requests/wagering.http` é uma coleção de requisições prontas (formato
[REST Client](https://marketplace.visualstudio.com/items?itemName=humao.rest-client)
do VS Code, ou aberta nativamente no IntelliJ/WebStorm) cobrindo os fluxos
principais: abrir carteira, submeter cada `kind` de operação (`BET`, `WIN`, `LOSS`,
`REFUND`, `ROLLBACK`), replay idempotente, rejeição por saldo insuficiente, retenção
por referência ausente, consulta por id interno e por provedor, paginação do ledger,
reconciliação e health checks. Veja `requests/README.md` para o passo a passo.

Exemplo rápido via `curl`, com a API já rodando em `localhost:3000`:

```bash
# Abrir uma carteira
curl -s -X POST http://localhost:3000/wallets \
  -H 'content-type: application/json' \
  -d '{"playerId":"0192f28f-5dc0-7d58-bdb2-814ad6a0f4a1","initialBalance":{"amount":"1000.00","currency":"BRL"}}'

# Submeter uma aposta (substitua <walletId> pelo id retornado acima)
curl -s -X POST http://localhost:3000/wagering/transactions \
  -H 'content-type: application/json' \
  -H 'idempotency-key: provider-a:bet-001' \
  -d '{"providerId":"provider-a","externalTransactionId":"bet-001","playerId":"0192f28f-5dc0-7d58-bdb2-814ad6a0f4a1","walletId":"<walletId>","roundId":"round-987","gameId":"fortune-chimp","kind":"BET","money":{"amount":"25.00","currency":"BRL"}}'
```

## Teste de carga

```bash
# 1. Ambiente de dev no ar (ver Setup acima), API e worker rodando
bun run dev &
APP_ROLE=worker bun run src/main.ts &

# 2. Instalar k6 (não é dependência do bun add)
#    https://k6.io/docs/get-started/installation/

# 3. Semear as carteiras
bun run scripts/load-test/seed.ts

# 4. Rodar os três cenários (distributed, hot_wallet, replay)
bun run test:load

# 5. Verificar correção pós-carga (reconciliação de todas as carteiras tocadas,
#    ausência de PENDING, drenagem do outbox)
bun run scripts/load-test/verify.ts
```

Metodologia completa, resultados e análise em [`LOAD-TEST.md`](./LOAD-TEST.md).

## Arquitetura

Hexagonal/DDD com quatro camadas (`domain`, `application`, `infrastructure`,
`interface`) mais `workers` para os processos de background, com a dependência entre
camadas verificada em tempo de lint (`eslint-plugin-boundaries`, política única em
`eslint/layer-policies.mjs`). `Money` como value object baseado em `decimal.js`
(nunca `number`/`float` para dinheiro). Idempotência em três camadas independentes:
por chave de negócio (`wager_transactions`), por mensagem (`inbox_messages`) e por
evento de saída (`eventId` estável na outbox). Ledger append-only e imutável como
fonte de auditoria; `wallets.balance` é uma projeção materializada, verificável a
qualquer momento via `POST /wallets/:id/reconciliation`.

## Limitações conhecidas

- **Autenticação não implementada** (ADR-017, deliberado — o desafio não exige e
  declara que não pontua). `AuthGuard` no-op registrado no boundary HTTP como ponto
  de extensão declarado; `ProviderIdentityPort`/`DeclaredProviderIdentity` leem o
  `providerId` do corpo da requisição sem verificação. Qualquer chamador pode se
  apresentar como qualquer provedor — a superfície não deve ser exposta fora de rede
  confiável.
- **T-065 (três ou mais instâncias de processo real simultâneas)** não foi coberto
  por um teste automatizado nesta entrega — os testes de concorrência existentes
  (`tests/concurrency/`) provam paralelismo real dentro de um único processo Bun
  contra Postgres/SQS reais (a fonte dominante de bugs de corrida num sistema como
  este), mas não descartam por si só um bug de estado compartilhado em memória entre
  instâncias de processo separadas.
- Métricas de espera por lock de wallet, lag do outbox, duplicatas de inbox e
  mensagens em DLQ (citadas no catálogo de métricas do desenho original) não foram
  instrumentadas — a Fase 7 cobriu transações por `kind`/`status`, rejeições por
  `failureCode`, replays de idempotência e latência HTTP.
