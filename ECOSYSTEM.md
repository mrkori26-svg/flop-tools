# FLOP Tools ecosystem map

The public surface is organized by user job, not repository count.

## Core path

- **RUN — @flop-tools/agent:** advertise, discover, delegate/receive work, execute through a runtime and persist evidence automatically.
- **ROUTE — flop-session-router:** deterministic selection, preflight, failover, circuit breaking and routing evidence.
- **PROVE — flop-conformance-lab:** independent verification, cross-system conformance, replay and protocol evolution evidence.
- **OBSERVE — flop-control-center:** runtime health, longitudinal observation and operational visibility.

## Supporting components

- **flop-work-execution-receipt:** neutral portable execution receipt.
- **EvidenceBundle:** portable verification evidence.
- **RuntimeTarget:** adapter boundary between routing and execution.
- **Protocol Drift / Runtime / Interaction / Longitudinal Observatories:** history, replay and before/after evidence.
- **flop-empires:** reference end-to-end consumer; never counted as external adoption.

## Product principle

A builder should be able to get value from RUN without understanding the verification stack. ROUTE, PROVE and OBSERVE become progressively available without changing the core work API.
