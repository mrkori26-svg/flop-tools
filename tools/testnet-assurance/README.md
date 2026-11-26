# FLOP Testnet Assurance (experimental v1)

Independent, read-only community tooling. Not an official FLOP Labs product, wallet, transaction signer, score oracle, or cryptographic light client.

## Quick start

Requires Node.js 22.13+; the core and capture CLI require no npm installation. Commands run from the repository root.

```sh
node --test tools/testnet-assurance/assurance.test.mjs
node tools/testnet-assurance/cli.mjs capture > capture.json
node tools/testnet-assurance/cli.mjs readiness capture.json > certificate.json
node tools/testnet-assurance/cli.mjs verify-certificate certificate.json capture.json
node tools/testnet-assurance/cli.mjs faucet capture.json
```

Use a shell that writes UTF-8 (PowerShell 7+, cmd.exe, bash). Capture contacts only fixed public URLs. The only POSTs are allowlisted read-only JSON-RPC methods; no signing, transactions, faucet requests, inference, credentials, or gateway mutations. HTTP failures are retained as unobserved, not service closure. The output may contain public service metadata; inspect before sharing.

## Five surfaces

| Surface | What it does | What it does not do |
|---|---|---|
| Readiness certificate | Binds captured observations, runtime, SDK version range, supplied account evidence, and service findings to SHA-256 | Not a signature, independent trust proof, or authority to act |
| Compatibility matrix | Compares exact pallet/call names, indices and textual argument types at two snapshots; reports case mismatches | Not semantic or full SCALE ABI compatibility |
| Voucher evidence ledger | Deduplicates supplied finalized events and checks an explicit activation boundary | No scoring or earned voucher assertion |
| Faucet state machine | Separates policy, chain binding, health, daily cap, and contract drift | No account eligibility or claim execution |
| Settlement verifier | Reconciles normalized receipt and event fields with exact integer accounting and supplied anchors | No native event decoding, signature proof, or inference settlement attestation |

## Metadata and SDK

Install `@polkadot/types` in a separate trusted project, or use an existing trusted project that already has the decoder. For SDK observation, that project must also have `@flop-labs/sdk` installed. The CLI never installs dependencies or runs external executables. It loads these explicitly chosen local libraries.

```sh
node tools/testnet-assurance/cli.mjs decode-metadata capture.json /path/to/trusted/project > metadata.json
node tools/testnet-assurance/cli.mjs sdk-observe capture.json /path/to/trusted/project > sdk-capture.json
node tools/testnet-assurance/cli.mjs readiness sdk-capture.json
node tools/testnet-assurance/cli.mjs compatibility metadata-before.json metadata-after.json requirements.json
```

A requirements file is a JSON array such as `[{"pallet":"FlopPoUI","call":"submit_validator_attestation"}]`. The version-range result only checks the SDK's exported supported versions against the captured runtime and published version; it does not assert individual method correctness. The metadata decoder reports textual type descriptions; those can change without a wire-format change or omit differences in nested type definitions. Compare equivalent decoder versions and keep raw metadata bytes.

## Input conventions

- Monetary values are nonnegative integer strings in base units unless explicitly named `*Flop`. Never use floating point for balances.
- Readiness accepts a capture envelope (`{schema,asOf,input}`). For replay, `asOf` is the original Unix millisecond time; for a current decision capture again. Each observation carries source, status, observedAt, data and SHA-256 of the canonical record. A hash is an integrity check, not provenance authentication.
- Optional `input.account`: `{genesis,blockHash,height,finalized,registered,free,minimumStake,estimatedFee}`. Use the same finalized anchor as the RPC snapshot; an independently checked fee estimate is essential. Registration sufficiency is only a necessary funding check, not admission.
- A finalized context is `{genesis,head:{genesis,height,blockHash,finalized:true},blocks:[...]}`; each entry has the same shape as head. This is a caller-supplied anchor index, not a chain proof. `verify-anchors FILE` checks up to 128 supplied anchors against the live, fixed Testnet RPC; it does not authenticate event payloads.
- `voucher-ledger FILE` expects `{context,activation,events}`. Activation is null unless the official network documentation announces a finalized start; otherwise it must provide `{genesis,height,blockHash,finalized:true,announced:true,source:"https://ask.flop.finance/networks/testnet"}`. Events add `eventIndex,kind,amount,account,success` to a finalized anchor. Only nonzero successful settlements at or after that boundary become candidates, never credited vouchers. Faucet grants, failed events and pre-activation settlements cannot qualify in this model.
- `settlement FILE` expects `{context,receipt,event}`. The receipt has `genesis,channelId,payer,payee,workSha256,escrow,paid,fee,refund`; the event adds the same fields and a finalized anchor plus `eventIndex,kind:"settlement",success:true,receiptSha256,disputeStatus:"closed"`. Amount conservation is checked using BigInt. This is a normalized adapter contract, **not** a claim that the native FLOP event schema contains these fields. Native event decoding, receipt signatures, dispute semantics and independent finality are required before a production claim of settlement.

Use the synthetic examples generated by `node tools/testnet-assurance/examples.mjs`. They are intentionally fictitious and must never be represented as on-chain events.

## Evidence and limitations

- Testnet identity: https://ask.flop.finance/networks/testnet
- Faucet contract: https://faucet.flop.network/chain ; https://faucet.flop.network/limits ; https://faucet.flop.network/health
- Public gateway health: https://api.flop.network/health
- Reported metadata naming mismatch: https://github.com/flop-labs/network/issues/1303
- Faucet indexer/readiness divergence: https://github.com/flop-labs/network/issues/1339 and https://github.com/flop-labs/network/issues/1432
- Registration funding shortfall: https://github.com/flop-labs/network/issues/1370
- Draft airdrop rules: https://flop.finance/airdrop/

The opening Testnet genesis is pinned. If the network resets, stop and independently review the official replacement identity; do not silently fall back to Devnet. No economic operation is authorized by any output.

See [the dated public smoke-test record](LIVE_2026-11-26.md) for a real RPC and decoder check, including a minimized compressed public evidence bundle and replayable certificate. `retain-public.mjs CAPTURE OUTPUT.json.gz CERTIFICATE.json` can create a minimized projection from a capture, discarding account data and unrelated service fields; inspect before sharing. Live voucher credit and settlement were not demonstrated.
