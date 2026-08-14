# Teste de Carga — Distributed Wagering Processor

## Metodologia

Ferramenta: [k6](https://k6.io) v0.54.0, script em `load/wagering.js`.

Ambiente: instância única local (Postgres + LocalStack via `docker-compose.yml` de
desenvolvimento, portas 5432/4566), roles `api` e `worker` (outbox publisher +
pending reference retry) rodando como processos separados na mesma máquina que gerou
a carga.

**Limitação declarada, honestamente:** o gerador de carga (k6) disputa CPU com o
sistema sob teste na mesma máquina. Os números abaixo são um **limite inferior** de
capacidade, não devem ser extrapolados para dimensionamento de produção, e não foram
coletados em hardware dedicado nem em ambiente isolado do gerador. O objetivo desta
rodada é provar **correção sob carga concorrente real**, não medir throughput máximo.

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

Decisões de design, conforme já apontado no plano:

- **Chave de idempotência única por iteração** em `distributed`/`hot_wallet`
  (`provider-load:<vu>-<iter>-<timestamp>`) — enviar a mesma chave em todas as VUs
  mediria só o caminho de replay (mais barato: sem lock, sem ledger, sem outbox), e
  não o processamento real. O cenário `replay` inverte isso deliberadamente, reusando
  a mesma chave a propósito, para provar que o caminho de replay funciona sob
  concorrência.
- Cada VU do cenário `distributed` fica fixo numa única carteira
  (`distributedWallets[__VU % 50]`) e rastreia sua última `BET` bem-sucedida (mesmo
  `roundId`) para eventualmente enviar um `REFUND` coerente — referenciar uma aposta
  de outra carteira ou outro `roundId` é rejeitado pelo próprio sistema
  (`REFERENCE_CONTEXT_MISMATCH`), o que é o comportamento correto, não um bug do
  gerador de carga (isso foi encontrado e corrigido durante a preparação deste teste).
- `422` por regra de negócio é contabilizado num counter separado
  (`wagering_unexpected_errors_total` só soma o que **não** é uma resposta válida do
  catálogo de status), para não poluir a taxa de erro com rejeições esperadas.

### Verificação pós-carga (T-072)

`scripts/load-test/verify.ts` roda depois de cada execução e:

1. Chama `POST /wallets/:id/reconciliation` para as 52 carteiras tocadas;
2. Consulta `wager_transactions` por `status = 'PENDING'` (nunca deveria haver
   nenhuma fora de uma transação em voo — indicaria falha de atomicidade);
3. Consulta `status = 'PENDING_REFERENCE'` (esperado 0 nesta carga específica, já
   que nenhum cenário envia uma reversão antes da operação original);
4. Consulta `outbox_messages WHERE published_at IS NULL` (mensagens ainda não
   publicadas — mede o atraso do outbox publisher).

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
mensagens outbox ainda não publicadas: 0 (após o fix descrito abaixo)
```

**wallet.balance == SUM(CREDIT) − SUM(DEBIT) do ledger** se manteve verdadeiro nas
52 carteiras, incluindo a hot wallet sob apostas concorrentes reais de 10 VUs
simultâneos — a mesma verificação final obrigatória exigida pela Fase 8 também vale
aqui.

## Achado real: gargalo no outbox publisher sob carga sustentada

A primeira execução completa do teste de carga (antes do fix) revelou que
`outbox_messages WHERE published_at IS NULL` **crescia continuamente** em vez de
estabilizar — passou de ~13.000 para ~16.000+ mensagens em 20 segundos de observação,
com o processo `worker` vivo e consumindo CPU (não travado, apenas lento demais).

Causa raiz: `OutboxPublisherWorker.publishPendingBatch()` despachava cada mensagem
do lote de forma **sequencial** (`for...of` com `await` a cada `SendMessageCommand`).
Com `batchSize=50` e latência de rede de ~20-30ms por chamada ao LocalStack, o
throughput real do publisher ficava em torno de 30-40 msg/s — muito abaixo da taxa de
geração de eventos sob os ~290 req/s HTTP observados (cada operação processada gera
1 ou 2 eventos de integração).

**Corrigido** (commit separado, PR próprio, fora do escopo desta task de teste):
as chamadas de rede ao SQS agora disparam em paralelo via `Promise.all`; os updates
no banco continuam sequenciais, porque compartilham a mesma conexão/transação do
`UnitOfWork`, que não suporta múltiplas queries concorrentes na mesma conexão. Após
o fix, a mesma carga de ~16 mil mensagens drenou completamente em menos de um minuto,
em vez de crescer indefinidamente.

Esta é exatamente a razão de existir desta fase, conforme o próprio plano do desafio
declara: **é a verificação de correção pós-carga, e não o número de throughput, que
transforma o teste de carga em evidência — não em vaidade.**

## Limitações conhecidas e não cobertas nesta rodada

- Execução única, máquina compartilhada com o gerador — sem isolamento de hardware,
  sem repetição estatística formal;
- Não foi medido o comportamento sob 3+ instâncias da API simultâneas (esse cenário é
  coberto separadamente pelos testes de concorrência real de processo único da Fase 8,
  não pelo teste de carga);
- O cenário `hot_wallet` mede espera por lock indiretamente pela latência agregada,
  não expõe a métrica `wallet_lock_wait_seconds` mencionada no catálogo de métricas —
  essa métrica específica não foi instrumentada na Fase 7 por tempo.
