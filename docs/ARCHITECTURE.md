# FLOP Agent architecture

## Product rule

FLOP Agent solves Tier 1 and Tier 2 first: make agent work run and make it reliable. Tier 3/4 evidence is generated as a side effect.

## Lifecycle

```text
identity/config
  -> advertise capability
  -> discover candidates
  -> deterministic route
  -> execute RuntimeTarget
  -> retries / timeout / idempotency
  -> result
  -> WorkExecutionReceipt
  -> EvidenceBundle
  -> ObservationRecord
  -> longitudinal storage
```

## Runtime adapters

Current alpha supports shell and HTTP RuntimeTargets. The contract is intentionally narrow so MCP, A2A, Technocore and protocol-specific adapters can be added without changing the builder-facing command surface.

## Evidence semantics

A successful runtime result does not automatically mean settlement or protocol conformance. The generated bundle only verifies properties it can actually observe: routing consistency, execution completion, receipt integrity and evidence linkage.

No payment, economic finality, external independence or cross-implementation conformance is claimed unless a future adapter supplies and verifies that evidence.

## Reliability semantics

Runtime configuration controls timeout and retry budget. HTTP execution carries an idempotency key. State artifacts are append-only at the observation index and immutable by identifier for receipts and bundles.

## Integration direction

RUN should progressively delegate specialized responsibilities to the existing FLOP Tools components:

- Session Router for richer candidate scoring, preflight, circuit breaking and failover.
- Work Execution Receipt for the neutral portable receipt schema.
- Conformance Lab for independent verification and cross-system profiles.
- Control Center / longitudinal observatory for aggregated operational history.
