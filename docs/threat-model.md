# Threat Model

This document identifies potential threats to the Polar platform and the mitigations implemented to address them.

## Threat Actors

1.  **Malicious Prompt Injection**: An external entity provides input to the agent designed to trick it into performing unauthorized actions.
2.  **Malicious Skill Author**: A third-party skill contains code designed to exfiltrate data or perform unauthorized actions.
3.  **Compromised LLM Output**: The LLM itself generates harmful or incorrect plans due to training data or internal failure.
4.  **Curious-but-Honest User**: A user accidentally attempts an action they shouldn't, potentially causing data loss or exposure.
5.  **Accidental Misconfiguration**: Incorrect policy settings that inadvertently grant too much authority.

---

## Threat Surfaces

| Surface | Description |
| --- | --- |
| **Worker Spawning** | The ability to start new processes with system access. |
| **Tool Calls** | Requests from agents to perform actions like reading files or hitting APIs. |
| **Memory Writes** | Storing information that might be used for future reasoning. |
| **Skill Installation** | Adding new code to the system. |
| **UI Actions** | User interactions that change policy or view sensitive data. |
| **Network Egress** | Connections from workers to the internet. |

---

## Mitigations

| Threat | Surface | Mitigation | Enforcement Point |
| --- | --- | --- | --- |
| Prompt Injection | Tool Calls | Capability tokens with narrow, runtime-evaluated scope. | Runtime & Gateway |
| Malicious Skill | Worker/Tool | Path/Resource constraints in tokens; no direct system access. | Gateway |
| Compromised LLM | Tool Calls | Policy-governed denial of any action not explicitly granted. | Runtime |
| Data Exfiltration | Network | Egress filtering and scoped network tokens (Stage 2+). | Gateway |
| Policy Bypass | API | No bypassed paths; all side-effects require signed tokens. | Runtime |
| Audit Tampering | Audit Log | Append-only, immutable storage; separate from worker process. | Runtime |

---

## Key Invariants

- **No "Trust the Model"**: The system never assumes the LLM's output is safe or authorized.
- **Fail Closed**: Any error in token verification or policy evaluation results in a denial.
- **Separation of Concerns**: The component that plans (Agent) never executes; the component that executes (Gateway) never plans or decides policy.
- **Audit Evidence**: Every attempt, whether allowed or denied, produces an immutable audit record.
