# FLOP Tools ecosystem map

The public surface is intentionally organized by role instead of repository count.

## Core

- **ROUTE — flop-session-router:** routing and RuntimeTarget selection.
- **PROVE — flop-conformance-lab:** independent verification and portable conformance evidence.
- **OBSERVE — flop-control-center:** operational and longitudinal observation.

## Components

- **flop-work-execution-receipt:** neutral execution/evidence envelope between runtime and verification.
- **EvidenceBundle:** portable evidence produced or consumed by conformance flows.
- **Protocol Drift Observatory:** detects when pinned upstream sources change and invalidates stale assumptions.
- **Runtime Observatory:** executes bounded probes and records reproducible runtime evidence.

## Reference and research

- **flop-empires:** reference application for the complete Route -> Prove -> Observe journey.
- **flop-protocol-reproducibility-audits:** focused reproducibility research and upstream evidence.
- **inference-market:** independent consumer/experiment for inference pricing and runtime integration.

## Technocore ecosystem

- **technocore-did-tool / technocore-did-starter:** identity and onboarding utilities.
- **awesome-technocore:** ecosystem index.
- Technocore observations are evidence inputs, not a separate FLOP Tools core surface.

Forks and one-off reproductions remain supporting evidence rather than top-level products.