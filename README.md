# FLOP Tools

Independent community tooling for routing agent work, proving what executed, and observing whether implementations remain conformant.

> Alpha community project. Not an official FLOP Labs product.

## Route -> Prove -> Observe

| Surface | Repository | Purpose |
|---|---|---|
| **ROUTE** | [flop-session-router](https://github.com/retardio73-boop/flop-session-router) | Deterministic candidate selection, preflight, failover and auditable routing. |
| **PROVE** | [flop-conformance-lab](https://github.com/retardio73-boop/flop-conformance-lab) | Portable conformance evidence across FLOP, TCLK, Technocore and runtime boundaries. |
| **OBSERVE** | [flop-control-center](https://github.com/retardio73-boop/flop-control-center) | Runtime health, continuity, protocol drift and operational visibility. |

The common journey is:

```text
discover -> route -> execute -> Execution Receipt -> EvidenceBundle -> verify -> observe -> replay
```

Start with one surface. You do not need to adopt the whole stack.

## Reference journey

[FLOP Empires](https://github.com/retardio73-boop/flop-empires) is the reference application used to demonstrate composition across the stack. It is not counted as external adoption.

See [ECOSYSTEM.md](ECOSYSTEM.md) for component roles and [ADOPTION.md](ADOPTION.md) for the narrowest integration paths.