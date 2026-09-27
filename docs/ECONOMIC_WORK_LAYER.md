# Economic Work Layer

The Economic Work Layer turns FLOP Tools from a run/route/prove surface into a demand-aware work runtime.

## Flow

```
market discovery
  -> deliverability filter
  -> capability classification
  -> counterparty reputation
  -> funded/unfunded ranking
  -> worker execution
  -> PreparedEconomicExecution
  -> external settlement observation
  -> verification
  -> EconomicWorkReceipt
  -> operational memory / reputation update
```

A funded offer is not treated as paid merely because it advertises a reward. Work with a payment requirement remains `WORK_COMPLETED_PAYMENT_PENDING` until external settlement evidence verifies.

## Workers

- `inference`: Gemini first, local Ollama fallback, model/provider metadata and output digest.
- `conformance`: Conformance Lab verification and deterministic protocol work where available.
- `execution-proof`: portable Work Execution Receipt with explicit evidence coverage.
- `settlement`: NO_VALUE evidence, testnet verification, or externally observed EVM testnet transactions.
- `proposal-transport`: deterministic proposal/delivery envelope and digest.
- `research-protocol`: bounded HTTPS/text source analysis with source digest.

The autonomous Technocore operator also has a deterministic TCLK transcript fold path using the vendored TCLK reference state machine. If a task supplies only room/time/sender/frame rows, transition semantics are reproduced but transport signatures are not claimed as verified.

## Market

Default funded feed:

`https://flop-market.pages.dev/open.json`

`economic-scan` normalizes offers and rejects deliverables the current workers cannot actually produce, including image/video/audio/UI-artifact requests and unrequested dataset-generation work. Payment boilerplate is not used to classify the task itself.

## Reputation and memory

Operational outcomes are append-only and idempotent:

- ACCEPTED
- COMPLETED
- VALIDATED
- FAILED
- EXPIRED
- REJECTED

Portable reputation is derived from those outcomes, not from self-description. Signed Technocore capability statements are stored separately as `SIGNED_SELF_DECLARED`: the signature proves who made the claim, not that the capability exists.

Longitudinal views are available for 7/30/90 days.

## Settlement boundary

The control plane never needs custody to perform market selection, planning, execution, reconciliation, delivery verification or receipt generation.

Value movement remains outside the control plane:

```
PreparedEconomicExecution
  -> authorized external execution
  -> ExternalExecutionEvidence
  -> rail verification
  -> final receipt
```

The EVM observer is read-only. It verifies chain id, transaction success, parties when supplied, amount, block, confirmations and finality. It does not sign or send transactions.

## CLI

```
flop-agent economic-scan
flop-agent economic-run
flop-agent economic-capabilities
flop-agent economic-discover-capabilities
flop-agent economic-reputation
flop-agent economic-memory
flop-agent economic-finalize --prepared <file> [--evidence <file>]
```

Useful options:

```
--state <dir>
--market-feed <https-url>
--min-reward <number>
--assets FLOP,PAPER
--allow-unfunded
```

The autonomous Useful Work Operator writes shared status and memory under:

`runtime/economic-work/`

and is launched through a singleton hidden startup entry on Windows.
