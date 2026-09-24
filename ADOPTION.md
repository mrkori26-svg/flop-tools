# Adoption paths

The adoption strategy is incremental. Do not ask external builders to adopt the whole stack.

## Smallest useful adoption

1. Install or vendor FLOP Agent.
2. Publish one capability.
3. Receive or delegate one bounded work request.
4. Keep the generated receipt and evidence bundle.

That single Tier 1 integration can later become:
- Session Router consumer;
- RuntimeTarget adapter;
- Work Execution Receipt producer;
- EvidenceBundle producer;
- Conformance Lab CI consumer;
- longitudinal observation source.

## External integration sequence

```text
make one task run
-> keep one receipt
-> verify one evidence bundle
-> pin one conformance profile in CI
-> retain before/after history
```

External adoption means an independent project consumes one of these surfaces. FLOP Empires remains a reference application only.

## Outreach rule

Lead with the external builder's immediate problem. Offer a minimal executable integration, a fixture, an adapter or a reproducible before/after result. Do not lead with a request to adopt the entire FLOP Tools stack.
