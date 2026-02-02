# Doctor / Diagnostics Subsystem

The `doctor` (or diagnostic) subsystem is a security tool meant to detect and surface misconfigurations before they lead to breaches or failures.

## Required Checks

1.  **Policy Integrity:** Verify that the 'deny-by-default' invariant is still enforced.
2.  **Key Health:** Check that capability signing keys are present, valid, and not leaked.
3.  **Audit Health:** Ensure the audit log is writable, append-only, and not corrupt.
4.  **Token Verification:** Scan for expired or over-scoped capability tokens.
5.  **Gateway Health:** Confirm the gateway is active and enforcing policies as expected.
6.  **Cleanup Jobs:** Verify background tasks like Memory TTL cleanup are running.
7.  **Resource Health:** Detect orphaned agents or excessive resource consumption.

## Usage

- **CLI:** `polar doctor` runs a full suite of checks and outputs results.
- **API:** An endpoint `/doctor` for the UI to display system health.
- **CI/Startup:** The runtime can be configured to run doctor checks on boot and fail-closed if critical issues are found.

## Severity Levels

- **CRITICAL:** Immediate security risk (e.g., signing key leaked, audit failing). System may fail-closed.
- **WARNING:** Potential issue or non-compliant state (e.g., overly broad permissions, missing cleanup).
- **INFO:** General status information.
