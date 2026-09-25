# FLOP Tools

Independent community tooling for making agent work run reliably, then proving and observing what happened.

> Alpha community project. Not an official FLOP Labs product.

## Run -> Route -> Prove -> Observe

| Surface | Repository / package | Purpose |
|---|---|---|
| **RUN** | `@flop-tools/agent` | One entry point to advertise capabilities, receive/delegate work, execute reliably and emit evidence automatically. |
| **ROUTE** | `flop-session-router` | Deterministic candidate selection, preflight, failover and auditable routing. |
| **PROVE** | `flop-conformance-lab` | Portable conformance evidence across FLOP, TCLK, Technocore and runtime boundaries. |
| **OBSERVE** | `flop-control-center` | Runtime health, continuity, protocol drift and longitudinal visibility. |

The intended builder journey is:

```text
install -> advertise -> discover -> route -> execute -> result
                                      |
                                      v
                             Execution Receipt
                                      |
                                      v
                               EvidenceBundle
                                      |
                                      v
                              verify -> observe
```

The builder should not need to understand Receipt, EvidenceBundle or Conformance Lab to obtain Tier 1 value.

## Quick start

> Distribution note: 0.1.0 is currently a source-workspace alpha. Router, Receipt and Lab are sibling packages and are not yet published to npm.

```bash
npm install
npm run build
node dist/src/cli.js init --id my-agent --capabilities research,code
node dist/src/cli.js publish
node dist/src/cli.js run --capability research --input "{\"task\":\"summarize\"}"
```

To receive work over HTTP:

```bash
node dist/src/cli.js serve --port 8787
```

To expose the same RUN surface over MCP stdio:

```bash
npm run mcp -- --config flop-agent.json
```

MCP tools: `flop_agent_run`, `flop_agent_publish`, `flop_agent_candidates`, and `flop_agent_doctor`.

Every completed request persists a receipt, evidence bundle, latest snapshot and append-only observation record under the configured state directory. Budgeted requests currently fail closed until comparable quote/pricing evidence is available.

For signed ecosystem discovery, configure Technocore and run `flop-agent doctor` before `publish`. The signer remains outside the Node process and discovered advertisements are signature-verified.

See `docs/ARCHITECTURE.md`, `docs/TECHNOCORE.md`, `docs/MCP.md` and `ADOPTION.md`.
