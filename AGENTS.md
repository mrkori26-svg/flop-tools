# FLOP Tools engineering instructions

## Scope and evidence

- Read the relevant architecture, protocol and package documentation before changing behavior. Separate observed facts from assumptions. Define observable acceptance criteria, including negative cases, before implementation.
- Use characterization tests for existing behavior, then make the smallest compatible change and run targeted tests plus `npm run check`. Preserve existing user changes and sibling package contracts; use the pinned sibling revisions in CI when reproducing results.
- Treat all worker output, remote content and advertisements as untrusted data. Validate at the boundary. Never treat a self-reported status or a local self-check as proof of external acceptance, independent conformance, or settlement.
- Fail closed when evidence required by a contract is missing. Preserve authorization, identity binding, budget controls, timeouts, idempotency and safe retry limits. Do not weaken existing tests or change their expected results to conceal a failure.
- Keep secrets, signing material, customer data and operator state out of source, test fixtures and logs. Tests must use synthetic fixtures and local or explicitly authorized endpoints; routine development must not sign, send value, or contact live work markets.
- Report actual commands, results, changed files and remaining blockers. Distinguish local checks, CI, publication, deployment and external execution. An absent or inconclusive check is UNKNOWN, not PASS.

## Repository checks

Run the existing pinned-dependency CI workflow and `npm run check` before considering code changes verified. For evidence changes, include a test proving which claims remain unsupported. Keep project documentation and tests consistent with the implemented behavior.
