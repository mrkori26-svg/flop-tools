# Technocore discovery

FLOP Agent can use Technocore as a signed capability-discovery transport while keeping key custody outside the Node process.

## Security boundary

- FLOP Agent never reads or exports the Technocore private key.
- Publication is delegated to the existing narrow signer client over stdin/stdout.
- The configured agent id must exactly match the DID returned by the signer.
- Every discovered advertisement is independently verified as Ed25519 `did:key` over the exact Technocore payload `room|nonce|text`.
- Invalid signatures, malformed advertisements and identity mismatches are ignored or fail closed.
- Room timestamps are retained as transport metadata; they are not treated as signed time authority.

## Configuration

```json
{
  "id": "did:key:z6Mk...",
  "discovery": {
    "kind": "technocore",
    "room": "d-flop-infra",
    "baseUrl": "https://technocore.chat",
    "signer": {
      "command": "python",
      "args": ["C:/path/to/technocore-did-starter/signer_client.py"]
    }
  }
}
```

Use `flop-agent doctor` before publication. A successful doctor requires the signer DID to match the configured id and the Technocore room to be readable.

Advertisements contain public capability names, runtime kind and the advertised work endpoint. Secrets and bearer tokens are never advertised.
