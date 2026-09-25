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

Current alpha supports shell and HTTP RuntimeTargets. MCP stdio is a control/access surface over the same orchestration, not a separate RuntimeTarget. The runtime contract remains intentionally narrow so A2A, Technocore and protocol-specific execution adapters can be added without changing the builder-facing work API.

## Evidence semantics

A successful runtime result does not automatically mean settlement or protocol conformance. The generated bundle only verifies properties it can actually observe: routing consistency, execution completion, receipt integrity and evidence linkage.

No payment, economic finality, external independence or cross-implementation conformance is claimed unless a future adapter supplies and verifies that evidence.

## Reliability semantics

Runtime configuration controls timeout and retry count. HTTP execution carries an idempotency key. State artifacts are append-only at the observation index and immutable by identifier for receipts and bundles.

Economic `budget` constraints are fail-closed in 0.1.0. Until ROUTE can obtain a comparable, provenance-bound quote, a budgeted request returns `BUDGET_ENFORCEMENT_UNAVAILABLE` rather than pretending the limit was enforced.

## Integrated composition

RUN now delegates specialized responsibilities instead of duplicating them:

- Session Router owns the persisted routing decision and config/snapshot hashes.
- Work Execution Receipt supplies the neutral portable receipt alongside the RUN receipt.
- Conformance Lab independently verifies every locally executed bundle with the `flop-agent` profile.
- Control Center consumes append-only `ObservationRecord v1` events through its agent-work observatory.

The local self-check is explicitly separate from independent Lab verification. For delegated work, the initiator also verifies that the returned receipt is bound to the Router-selected peer and independently re-runs the `flop-agent` Lab profile. Both runtime and conformance observations are appended locally with `role=delegator`, so longitudinal history does not disappear merely because execution happened elsewhere.

Neither layer infers payment settlement, economic finality, external independence or complete coverage without evidence for those claims.
