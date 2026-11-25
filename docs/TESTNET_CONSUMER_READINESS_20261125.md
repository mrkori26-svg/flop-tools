# FLOP Testnet consumer readiness — 2026-11-25

Scope: **read-only preparation** for Technocore agent consumer. This document is not a deployment authorization and does not change local configuration. No wallet, DID, registration, faucet claim, transaction, signature, or expenditure was made.

## Official evidence

| Property | Official value / finding |
|---|---|
| Launch | Live on 2026-11-24, **unscored**; not a merely tentative target |
| Chain ID | `flop_testnet` |
| RPC | `wss://testnet.flop.network/` |
| Opening genesis | `0x918abd58fb16306b30ef3886514cfaebffecb4de43e82b6f8ec4795c43cfd800` |
| Voucher activation | Future finalized upgrade block, **not announced**; no backfill |
| SDK | Official FAQ says `@flop-labs/sdk >=0.11.0`, CLI `@flop-labs/cli >=0.8.3` |
| SDK release discrepancy | Official GitHub releases page/API checked 2026-11-25 lists `sdk/v0.6.0` as latest release. **Cannot attest 0.11.0 from that channel** |
| Shared gateway | Model listing does **not** prove Testnet compute, miner settlement, or scoring; MCP health reported Devnet at opening |
| Faucet | Testnet `https://faucet.flop.network` distinct from Devnet `https://faucet.devnet.flop.network`; agent claiming requires signed request, intentionally out of scope |
| Node / miner pack | Signed raw chain spec / operator pack awaiting publication |
| Devnet | Separate network: no Devnet registration, work history, sponsorship or rewards transfer to Testnet |

Official sources (sole sources for FLOP operational claims):
- https://ask.flop.finance/networks/testnet
- https://ask.flop.finance/docs/testnet-and-timeline
- https://flop.finance/testnet/
- https://github.com/flop-labs/network/releases

## Six-priority acceptance gates

1. **P0 genesis and RPC:** Known from docs. To close *live connectivity*, execute only read-only `chain_getBlockHash(0)` against the official RPC, compare EXACT genesis, and independently fetch a finalized head and header. Fail closed on DNS/TLS/timeouts/mismatch. No live RPC proof obtained in this review.
2. **P0 SDK compatibility:** Verify a downloadable, integrity-checkable official `@flop-labs/sdk >=0.11.0` and `@flop-labs/cli >=0.8.3`, then build/execute pinned read-only smoke tests. Do not bypass runtime-version checks. **Blocked by official FAQ/release discrepancy.**
3. **P0 agent onboarding/funding:** Verify official agent-consumer guide on Testnet, preflight DID/wallet requirements without creating identities, confirm Testnet funding and admission. **Documentation partly published; execution prohibited by the agreed no-keys/no-faucet/no-signature constraint.**
4. **P0 inference and settlement:** Require Testnet-specific gateway endpoint/chain attestation and an independently verifiable session receipt + finalized settlement tied to Testnet genesis. **No official proof; do not treat Devnet gateway or API model listing as Testnet settlement.** No economic calls.
5. **P0 voucher start block:** **CLOSED for monitoring**: official answer is that no finalized activation block is announced and all earlier work scores zero. Reopen only on official publication of a specific activation block.
6. **P1 Router and Lab:** Add testnet as an opt-in, read-only network profile after gates 1–2; use genesis-bound tests, version compatibility assertions, RPC fail-closed behavior, devnet/testnet isolation tests and receipt provenance tests. Do not claim live integration until passing tests and official gateway on-chain attestation.

## Decision

**NO-GO for paid agent-consumer Testnet operation.** Opening and chain identity can be documented; consumer gateway settlement, pinned compatible release, credentialed onboarding and voucher start remain independently blocked or unverified. Read-only monitoring/rehearsal is allowed; no config writes or economic activity.

Recheck only the four official sources above. Notify only when a complete usable agent profile (genesis + RPC + Testnet gateway + compatible released SDK + onboarding) appears, or an official meaningful launch-status change is confirmed.
