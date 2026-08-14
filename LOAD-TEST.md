# Teste de Carga — Distributed Wagering Processor

## Metodologia

Ferramenta: [k6](https://k6.io) v0.54.0, script em `load/wagering.js`.

Ambiente: instância única local (Postgres + LocalStack via `docker-compose.yml` de
desenvolvimento, portas 5432/4566), roles `api` e `worker` (outbox publisher +
pending reference retry) rodando como processos separados.

### Preparação (T-070)

`scripts/load-test/seed.ts` abre, via `POST /wallets`, 52 carteiras antes da carga:

- 50 carteiras "distribuídas" (uma por VU do cenário `distributed`, saldo inicial de
  R$ 1.000.000,00 — alto o suficiente para nunca esgotar durante a execução, já que o
  objetivo do cenário é medir o caminho normal de processamento, não o de rejeição
  por saldo);
- 1 carteira "hot wallet" (cenário `hot_wallet`, saldo de R$ 5.000.000,00, todos os
  VUs desse cenário apostam nela simultaneamente — mede espera por lock sob
  contenção real numa única linha);
- 1 carteira de replay (cenário `replay`, saldo de R$ 1.000,00).

### Cenários (T-071)

Três cenários k6 rodando em sequência (`load/wagering.js`), cada um com VUs
constantes:

| Cenário | VUs | Duração | Mix de `kind` |
|---|---|---|---|
| `distributed` | 15 | 20s | 50% BET, 25% LOSS, 20% WIN, 5% REFUND |
| `hot_wallet` | 10 | 20s | 100% BET na mesma carteira |
| `replay` | 5 | 15s | BET com a **mesma** `Idempotency-Key` repetida a cada iteração |

Decisões de design:

- **Chave de idempotência única por iteração** em `distributed`/`hot_wallet`
  (`provider-load:<vu>-<iter>-<timestamp>`) — enviar a mesma chave em todas as VUs
  mediria só o caminho de replay (mais barato: sem lock, sem ledger, sem outbox), e
  não o processamento real. O cenário `replay` inverte isso deliberadamente, reusando
  a mesma chave a propósito, para provar que o caminho de replay funciona sob
  concorrência.
- Cada VU do cenário `distributed` fica fixo numa única carteira
  (`distributedWallets[__VU % 50]`) e rastreia sua última `BET` bem-sucedida (mesmo
  `roundId`) para eventualmente enviar um `REFUND` coerente.
- `422` por regra de negócio é contabilizado num counter separado
  (`wagering_unexpected_errors_total` só soma o que **não** é uma resposta válida do
  catálogo de status), para não poluir a taxa de erro com rejeições esperadas.

### Verificação pós-carga (T-072)

`scripts/load-test/verify.ts` roda depois de cada execução e:

1. Chama `POST /wallets/:id/reconciliation` para as 52 carteiras tocadas;
2. Consulta `wager_transactions` por `status = 'PENDING'`;
3. Consulta `status = 'PENDING_REFERENCE'`;
4. Consulta `outbox_messages WHERE published_at IS NULL`.

## Resultado da execução final

```
16.092 requisições HTTP, 292,56 req/s médio
checks: 100,00% (16.092 de 16.092)
http_req_failed: 0,00%
http_req_duration: méd=35,53ms  p90=50,23ms  p95=59,99ms  máx=1,37s

wagering_processed_total........: 10.421
wagering_idempotent_replay_total: 5.671
wagering_unexpected_errors_total: 0
```

Verificação pós-carga:

```
reconciliação: 52 consistentes, 0 inconsistentes
transações em PENDING: 0
transações em PENDING_REFERENCE: 0
mensagens outbox ainda não publicadas: 0
```

**wallet.balance == SUM(CREDIT) − SUM(DEBIT) do ledger** se manteve verdadeiro nas
52 carteiras, incluindo a hot wallet sob apostas concorrentes reais de 10 VUs
simultâneos.
