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

## Setup — rodando tudo com Docker (recomendado)

Único requisito: Docker com o plugin Compose. Sobe Postgres, LocalStack, roda as
migrations e sobe as três roles da aplicação (`api`, `consumer`, `worker`) com um
único comando:

```bash
docker compose up -d --wait
```

A API fica disponível em `http://localhost:3000`:

```bash
curl http://localhost:3000/health/live
curl http://localhost:3000/health/ready
```

Acompanhar logs de uma role específica:

```bash
docker compose logs -f api
docker compose logs -f consumer
docker compose logs -f worker
```

Derrubar tudo (inclusive o volume do Postgres):

```bash
docker compose down -v
```

O `Dockerfile` é a mesma imagem para as três roles — o comportamento muda pela
variável `APP_ROLE` (`api`, `consumer` ou `worker`), definida por serviço no
`docker-compose.yml`. O serviço `migrate` roda as migrations uma vez antes de
qualquer role subir (`depends_on: condition: service_completed_successfully`).

## Setup — rodando localmente com Bun (alternativa)

Útil para desenvolvimento com hot-reload (`bun --watch`).

```bash
# 1. Instalar dependências
bun install

# 2. Copiar o exemplo de variáveis de ambiente
cp .env.example .env

# 3. Subir só a infraestrutura (Postgres e LocalStack, sem a aplicação)
docker compose up -d --wait postgres localstack

# 4. Rodar as migrations
bun run migration:run

# 5. Subir a API
bun run dev
```

A API sobe em `http://localhost:3000` por padrão (`PORT` no `.env`). Health checks
em `GET /health/live` e `GET /health/ready` não exigem autenticação.

### Rodando as outras roles localmente

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

### Passo a passo via `curl`

Com a stack rodando (`docker compose up -d --wait`), na ordem:

```bash
PLAYER_ID="0192f28f-5dc0-7d58-bdb2-814ad6a0f4a1"

# 1. Abrir uma carteira com saldo inicial
WALLET_ID=$(curl -s -X POST http://localhost:3000/wallets \
  -H 'content-type: application/json' \
  -d "{\"playerId\":\"$PLAYER_ID\",\"initialBalance\":{\"amount\":\"1000.00\",\"currency\":\"BRL\"}}" \
  | jq -r '.id')
echo "walletId: $WALLET_ID"

# 2. Consultar a carteira
curl -s http://localhost:3000/wallets/$WALLET_ID

# 3. Submeter uma aposta (BET) — debita o saldo
curl -s -X POST http://localhost:3000/wagering/transactions \
  -H 'content-type: application/json' \
  -H 'idempotency-key: provider-a:bet-001' \
  -d "{\"providerId\":\"provider-a\",\"externalTransactionId\":\"bet-001\",\"playerId\":\"$PLAYER_ID\",\"walletId\":\"$WALLET_ID\",\"roundId\":\"round-987\",\"gameId\":\"fortune-chimp\",\"kind\":\"BET\",\"money\":{\"amount\":\"25.00\",\"currency\":\"BRL\"}}"

# 4. Reenviar a MESMA requisição (mesma Idempotency-Key) — replay idempotente,
#    devolve o resultado original com status 200 em vez de 201
curl -s -X POST http://localhost:3000/wagering/transactions \
  -H 'content-type: application/json' \
  -H 'idempotency-key: provider-a:bet-001' \
  -d "{\"providerId\":\"provider-a\",\"externalTransactionId\":\"bet-001\",\"playerId\":\"$PLAYER_ID\",\"walletId\":\"$WALLET_ID\",\"roundId\":\"round-987\",\"gameId\":\"fortune-chimp\",\"kind\":\"BET\",\"money\":{\"amount\":\"25.00\",\"currency\":\"BRL\"}}"

# 5. Submeter um ganho (WIN) — credita o saldo
curl -s -X POST http://localhost:3000/wagering/transactions \
  -H 'content-type: application/json' \
  -H 'idempotency-key: provider-a:win-001' \
  -d "{\"providerId\":\"provider-a\",\"externalTransactionId\":\"win-001\",\"playerId\":\"$PLAYER_ID\",\"walletId\":\"$WALLET_ID\",\"roundId\":\"round-987\",\"gameId\":\"fortune-chimp\",\"kind\":\"WIN\",\"money\":{\"amount\":\"50.00\",\"currency\":\"BRL\"}}"

# 6. Reverter a aposta do passo 3 (REFUND), referenciando pelo externalTransactionId
curl -s -X POST http://localhost:3000/wagering/transactions \
  -H 'content-type: application/json' \
  -H 'idempotency-key: provider-a:refund-001' \
  -d "{\"providerId\":\"provider-a\",\"externalTransactionId\":\"refund-001\",\"playerId\":\"$PLAYER_ID\",\"walletId\":\"$WALLET_ID\",\"roundId\":\"round-987\",\"gameId\":\"fortune-chimp\",\"kind\":\"REFUND\",\"money\":{\"amount\":\"25.00\",\"currency\":\"BRL\"},\"referenceExternalTransactionId\":\"bet-001\"}"

# 7. Apostar mais do que o saldo disponível — 422 com failureCode INSUFFICIENT_FUNDS
curl -s -X POST http://localhost:3000/wagering/transactions \
  -H 'content-type: application/json' \
  -H 'idempotency-key: provider-a:bet-insuficiente' \
  -d "{\"providerId\":\"provider-a\",\"externalTransactionId\":\"bet-insuficiente\",\"playerId\":\"$PLAYER_ID\",\"walletId\":\"$WALLET_ID\",\"roundId\":\"round-999\",\"gameId\":\"fortune-chimp\",\"kind\":\"BET\",\"money\":{\"amount\":\"999999.00\",\"currency\":\"BRL\"}}"

# 8. Consultar o histórico (ledger) da carteira
curl -s http://localhost:3000/wallets/$WALLET_ID/ledger

# 9. Reconciliar — confere que o saldo bate com a soma dos lançamentos
curl -s -X POST http://localhost:3000/wallets/$WALLET_ID/reconciliation
```

Todos os demais cenários (`LOSS`, `ROLLBACK`, retenção por referência ausente,
consulta por provedor, paginação por cursor) estão prontos em
`requests/wagering.http` — ver seção acima.

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

## Observabilidade

`docker compose up` já sobe Prometheus, Grafana e Tempo pré-configurados junto com a
aplicação — nenhum passo manual adicional.

- **Grafana** — `http://localhost:3030` (login anônimo, sem senha). O dashboard
  "Wagering Overview" (pasta *Wagering*) já vem provisionado, com painéis de
  transações por tipo/status, rejeições por `failureCode`, replays e conflitos de
  idempotência, latência HTTP (p95) e publicação do outbox.
- **Prometheus** — `http://localhost:9090`. Faz scrape do `/metrics` das três roles
  (`api:3000`, `consumer:9464`, `worker:9464`) a cada 5s.
- **Tempo** — recebe traces via OTLP (`http://tempo:4318` dentro da rede do compose,
  `http://localhost:4318` do host). Cada requisição HTTP e cada query no Postgres
  geram spans automaticamente (`@opentelemetry/instrumentation-http` e
  `-instrumentation-pg`), correlacionados na mesma trace.

As roles `consumer` e `worker` não têm servidor HTTP próprio, então cada uma sobe um
servidor HTTP mínimo só para expor `/metrics` (`METRICS_PORT`, padrão `9464`).

Logs estruturados em JSON (com `correlationId` por requisição) vão para stdout de
cada container — `docker compose logs -f <serviço>` (ver seção de Setup acima).

Para trocar o destino dos traces (por exemplo, ao rodar localmente sem o Tempo do
compose), defina `OTEL_EXPORTER_OTLP_ENDPOINT` antes de subir a aplicação; o padrão é
`http://localhost:4318`.

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
