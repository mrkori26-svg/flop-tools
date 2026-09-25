# FLOP Agent MCP surface

FLOP Agent exposes the same RUN orchestration used by its CLI and HTTP daemon over MCP stdio.

## Start

```bash
npm run mcp -- --config flop-agent.json
```

The MCP server writes protocol messages to stdout and diagnostics to stderr.

## Tools

- `flop_agent_run`: discover, route and execute bounded work; returns the evidence bundle.
- `flop_agent_publish`: publish the configured capability advertisement.
- `flop_agent_candidates`: read currently discoverable candidates without executing work.
- `flop_agent_doctor`: inspect configuration, discovery and signer readiness.

## Trust boundary

MCP is an access surface, not a second runtime implementation. Each tool delegates to the same `FlopAgent`, Session Router, portable receipt and Conformance Lab paths used by CLI/HTTP.

A successful MCP call does not imply payment settlement, economic finality or complete protocol conformance. Those claims remain evidence-gated and fail closed.

## Distribution status

Version 0.1.0 is currently a source-workspace alpha. Its Router, Receipt and Lab dependencies are sibling `file:` packages and are not yet published in the npm registry.

Use the checked-out FLOP Tools workspace until those packages have versioned registry releases.
