# Adoption paths

Adoption should be incremental and evidence-producing.

## 1. Use one fixture

Run a single Conformance Lab profile against your own evidence and retain `conformance-report.json`.

## 2. Use one action

Pin the Conformance Lab GitHub Action to an immutable commit and keep the result in CI.

## 3. Consume one receipt

Emit or consume a Portable Work / Execution Receipt without adopting Router or Control Center.

## 4. Implement one RuntimeTarget

Expose a narrow runtime adapter that Session Router can preflight and invoke.

## 5. Keep one observable result

Publish bounded runtime or conformance evidence so Control Center / observatory tooling can track change over time.

External adoption means another independently maintained project consumes a FLOP Tools surface and retains reproducible evidence. Self-tests, forks and stars are tracked separately.