# Local Deployment Pack

Local deployment is the reference implementation for Polar, designed for single-user operation on a workstation or private server.

## Characteristics

*   **Single Command**: The entire stack should start with a simple command (e.g., `pnpm run dev` or a dedicated `polar up`).
*   **Air-gapped Friendly**: No external cloud dependencies are required for core operation.
*   **Loopback Focus**: UI and API endpoints bind to `127.0.0.1` by default.
*   **Encrypted Local Storage**: Sensitive data at rest is encrypted using keys derived during initialization.

## Architecture

| Component | Implementation |
| :--- | :--- |
| **Runtime** | Node.js process |
| **Gateway** | Node.js process |
| **UI** | React SPA (Vite) served via local dev server or static host |
| **Storage** | SQLite (located in data directory) |
| **Secrets** | Encrypted JSON/SQLite store |
| **Audit** | Local SQLite table |

## Setup and Initialization

1.  **Installation**: `pnpm install`
2.  **Infrastructure Init**: `polar init local`
    *   Generates signing keys.
    *   Initializes SQLite schema.
    *   Creates default admin user/capability.
3.  **Startup**: `pnpm run dev`

## Security Hardening (Local)

*   **File Permissions**: The data directory should be restricted to the user running the process.
*   **Environment Variables**: Use `.env.local` for local overrides; never commit this file.
*   **Network**: Use host-based firewalls to ensure the gateway and runtime are not exposed to the LAN unless explicitly desired.

## Egress Control

In local mode, egress is monitored by the runtime. While the OS provides the actual network path, the application layer (Gateway) audits every outbound request initiated by a skill or agent.
