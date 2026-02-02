# Supply-Chain Threat Model

## Overview

As an extensible platform, Polar is a target for supply-chain attacks. This document identifies specific threats and maps them to mitigations within the architecture.

## Threat Table

| Threat | Description | Mitigation | Detection | Recovery |
| :--- | :--- | :--- | :--- | :--- |
| **Malicious Skill Author** | An author publishes a skill designed to exfiltrate data or perform unauthorized actions. | **Least Privilege**: Skills only have permissions granted by the user. **Skill Signing**: Verification of identity. | **Audit Log**: Monitoring of calls. **Capability Tokens**: Runtime enforcement of bounds. | **Revocation**: Instant removal of skill and permissions. |
| **Compromised Distribution** | A skill bundle is modified while in transit or on a registry. | **Bundle Hashing**: SHA-256 integrity check. **Signing**: Cryptographic verification. | **Verification Failure**: Runtime refuses to install tampered bundles. | **Re-install**: Fetch from a known good source. |
| **Dependency Substitution** | A skill update includes a malicious dependency that hijacks permissions. | **Permission Diffs**: Any increase in capability request requires re-consent. **Enforced Boundaries**: Skills cannot bypass Runtime policy. | **UI Notice**: Warning on permission change. | **Rollback**: Revert to the previous version. |
| **TOCTOU Attack** | A skill manifest is safe at check time but the code is swapped before use. | **Runtime Check**: Re-hash and re-verify signatures before loading the skill. | **Hash Mismatch**: Error on load. | **Emergency Halt**: Kill sessions using the skill. |
| **Update Rollback Attack** | An attacker forces the system to use an older, vulnerable version of a skill or core. | **Version Tracking**: Runtime tracks current and known prior versions. **Signed Manifests**: Include version in signed data. | **Version Regession**: Warning or block on downgrade without explicit intent. | **Re-upgrade**: Enforce the latest version. |

## Mitigation Principles

1.  **Never trust remote content**: Everything external must be verified.
2.  **Explicit Consent**: Authority is granted by the user, not assumed by the manifest.
3.  **Fail Closed**: If verification fails, the skill does not run.

## Acceptance Criteria

- [ ] Every identified threat has a corresponding enforcement point in the code.
- [ ] No threat is mitigated solely by "trusting the ecosystem".
