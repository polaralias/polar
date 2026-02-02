# Recovery and Revocation

## Overview

A secure system must be able to recover when a trust boundary is breached. Polar provides fine-grained revocation and a global emergency response mode.

## Revocation Mechanisms

Polar supports multiple levels of revocation to contain and neutralize threats:

1.  **Skill Disable**: Immediately stops a skill from being loaded or called.
2.  **Permission Revoke**: Removes a specific capability grant from a skill's policy.
3.  **Capability Invalidation**: Runtime-level invalidation of specific tokens.
4.  **Agent Termination**: Forcefully kills a running agent process.
5.  **Session Termination**: Ends a user's session and revokes all tokens issued during that session.

## Emergency Mode (The "Big Red Button")

In the event of a suspected systemic breach, the user can trigger **Emergency Mode**.

When active:
- All non-core skills are disabled.
- All active tool executions are frozen or terminated.
- All non-essential capability tokens are invalidated.
- The system enters a **Read-Only Inspection** state:
    - Audit logs are accessible.
    - Memory can be inspected.
    - No new actions can be taken.
- Diagnostics (Doctor) can be run to assess damage.

## Recovery Process

1.  **Neutralization**: Use revocation or Emergency Mode to stop the breach.
2.  **Analysis**: Use the Audit Log and Memory views to understand the impact.
3.  **Cleanup**: Remove malicious skills and restore memory/state from a known good snapshot if necessary.
4.  **Resumption**: Gradually re-enable skills and resume operations once the root cause is addressed.

## Acceptance Criteria

- [ ] A compromised skill can be neutralized within the UI in < 3 clicks.
- [ ] Emergency Mode behaviour is implemented and verified.
- [ ] System preserves audit data even during a hard stop.
