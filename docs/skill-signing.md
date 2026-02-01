# Skill Signing and Provenance

## Overview

Skill signing ensures that a skill bundle hasn't been tampered with since it was created and allows users to make informed trust decisions based on the author's identity.

In Polar, trust is local and explicit. While we may recognize signatures from known authors, the ultimate authority for allowing a skill to run resides with the local runtime and the user's explicit grant.

## Principles

1.  **Skill identity ≠ author identity**: A skill is identified by its ID and manifest, but its provenance is established by its signature and hash.
2.  **Trust is local and explicit**: The local runtime maintains its own trust store.
3.  **Unsigned is untrusted**: Skills without a valid signature are treated as untrusted, requiring higher scrutiny or being blocked by policy.

## Technical Details

### Skill Bundle Hash

Every skill bundle is hashed using SHA-256. This hash is recorded upon installation and verified during every load or update.

### Optional Author Signature

Skills may include a signature file (`signature.json`) containing:
- `signature`: The cryptographic signature of the skill bundle hash.
- `publicKey`: The public key of the author.
- `algorithm`: The signing algorithm (e.g., `Ed25519`).

### Local Trust Store

The Runtime maintain a list of trusted public keys.
- **Trusted**: Keys explicitly added by the user or pre-configured in the deployment profile.
- **Locally Trusted**: Skills installed from a local source that the user has specifically marked as "Trust this skill".
- **Untrusted**: Any skill that is unsigned or signed by an unknown key.

### Trust Levels

| Level | Description |
| :--- | :--- |
| `trusted` | Signed by a key in the local trust store. |
| `locally_trusted` | Explicitly trusted by the user for this specific installation. |
| `untrusted` | No verifiable provenance. |

## Runtime Enforcement

### Installation
1.  Verify the skill bundle hash.
2.  Check for a signature.
3.  If signed, check if the public key is in the trust store.
4.  Record the provenance (hash, signature, public key, trust level) in the Skill Store.

### Verification
- Before loading a skill, the Runtime re-calculates the bundle hash and compares it against the stored hash.
- If they don't match, the skill is disabled, and an audit event is logged.

## Acceptance Criteria

- [ ] Modified skill bundles are detected during installation and runtime checks.
- [ ] Trust decisions are visible in the UI and recorded in the audit log.
- [ ] Trust status does not bypass permission requirements.
