# Offline retained-receipt recheck
The MCP tool flop_receipt_recheck and worker execution-proof operation verify-retained
recompute schema, exact artifact digests and optional pinned Ed25519 signatures.
Input: {receipt, artifacts?: [{digest, bytesBase64}], expected?: {workId, participantId, publicKey, signature}}.
Use independently trusted expected values. No signer, payment, network or private key is needed.
The report remains PARTIAL after successful integrity checks: execution, settlement and observation
coverage stay UNKNOWN. A COMPLETED worker means the checker ran; consult output.result
and metadata.verdict for its conclusion.

The existing local authenticated gateway also supports receipt.verify. Its implementation
is distributed at tools/agent-play-api.mjs; createGateway accepts an explicit profile list,
token and worker function. Bind it to loopback. startLocalGateway(stackRoot) is the Windows
stack entry point and retains the existing private token file. It does not publish a network service.
conformance.verify profiles come from Conformance Lab, including router-evidence.
Run npm run check to verify the worker, MCP discovery and local HTTP integration.

CI uses the exact sibling revisions in INTEGRATION_REVISIONS.json, installs and builds them before the agent. Sibling directory names must match the package file dependencies.
