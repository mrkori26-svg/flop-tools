# Testnet readiness — independent community observation

**Observation date:** 24 November 2026. **Scope:** opening-phase documentation and a retained public chain read. This is not a live dashboard or an official FLOP Labs service.

| Capability | Opening-phase evidence | Status |
|---|---|---|
| Chain | Official network page reports live, unscored | Reported live |
| Finalized block | Retained read at 15:27:51 UTC: height 9963, runtime 1014035 | Historical observation, not a current head |
| SDK | Official page lists 0.9.0, with documented maximum runtime 1014034 | Opening runtime above documented maximum |
| Agent enrollment | No buyer enrollment evidence in this observation | Unverified |
| Faucet | Official page reports no verified public Testnet Self claim at opening; generic faucet reported Devnet | Agent grant unverified; do not conflate human and agent mechanisms |
| Inference and settlement | No correlated Testnet purchase and settlement in this observation | Unverified |
| Voucher scoring | Official page reports no finalized activation block announced; no retroactive credit | Not announced in source |

Sources: [official Testnet profile](https://ask.flop.finance/networks/testnet), [SDK compatibility issue #820](https://github.com/flop-labs/network/issues/820), [operator readiness issue #840](https://github.com/flop-labs/network/issues/840). The retained block read is a dated observation by this project, not a new independent verification. Recheck the official page and its documented read-only RPC method before relying on it.

## Small, useful proposal: capability-specific readiness

A single "live" Boolean conflates chain availability, buyer onboarding, faucet availability, inference settlement and reward activation. A machine-readable release manifest could publish **independent capability states**, source timestamps, explicit runtime compatibility, and a canonical genesis identifier. Clients should distinguish announced, verified, unavailable, stale and unknown; a model listing should never certify settlement. Activation should have its own finalized block reference.

Suggested acceptance cases:
- Chain live and SDK incompatible: chain reads remain available, but the client reports unsupported economic transport.
- Faucet bound to a different genesis: never request funds through that route for Testnet.
- Chain observation stale: show stale evidence rather than claiming current availability.
- Activation block unknown: do not attribute voucher credit.

This small public evidence card complements existing reports rather than requesting another onboarding slot. It does not claim funds, rewards, settlement, or an official SDK release.

## Integration pilots

FLOP Tools is evaluating independent onboarding diagnostics, SDK compatibility, evidence and reconciliation support for operators. We welcome opt-in pilot conversations through this repository's issues. Describe a concrete workflow or blocker; do not post private logs, credentials, identity documents or wallet secrets. Commercial integration and support scope can be discussed separately. The advanced implementation is not included in this public preview; existing open-source code retains its existing license. No paid plan or reward entitlement is asserted.
