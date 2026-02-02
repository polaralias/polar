# Cloud Deployment Pack

The Cloud Deployment Pack targets a standard managed environment (e.g., AWS, GCP, Azure), replacing local components with scalable, managed alternatives while preserving the Polar security kernel.

## Core Principle: Logic vs. Infrastructure

In a cloud environment, **infrastructure handles scale and durability, but the Runtime handles authority.**

*   **IAM** handles "Can this service write to this S3 bucket?"
*   **Polar Policy** handles "Can this Agent read this specific file?"

Cloud IAM must never be used as a substitute for Polar's granular tool and data access policies.

## Implementation Mappings

| Local | Cloud (Generic) | Example (AWS) |
| :--- | :--- | :--- |
| Process | Container / Serverless | ECS / Fargate / Lambda |
| SQLite | Managed RDBMS | RDS (PostgreSQL/Aurora) |
| Local Files | Object Storage | S3 |
| Local Secrets | Managed Secrets | Secrets Manager / Parameter Store |
| Local Logs | Centralized Logging | CloudWatch Logs |
| Loopback | Load Balancer | ALB with WAF |

## Shared Model Usage (e.g. AWS Bedrock)

When using cloud-hosted models like Bedrock:
*   The Runtime initiates the request to the LLM.
*   The LLM proposes actions.
*   The Runtime receives the proposal, validates it against policy, and if granted, directs the Gateway to execute it.
*   **The LLM never holds the capability token or the tool credentials.**

## Security Hardening (Cloud)

1.  **Network Isolation**: Runtime and Gateway should live in private subnets.
2.  **Audit Durability**: Audit logs should be streamed to write-once storage (e.g., S3 with Object Lock or a dedicated logging account).
3.  **Secrets Management**: Use roles and temporary credentials where possible. Skill-specific credentials should be fetched from the Secrets Manager at runtime by the Runtime service, never passed through agent prompts.
4.  **Doctor Validation**: The `polar doctor` command must be run as part of the CI/CD pipeline and at startup to ensure managed services are correctly configured and reachable.

## Egress Control (Cloud)

In cloud environments, egress should be controlled at two levels:
1.  **Network Layer**: VPC Egress Filtering (Security Groups / Network Firewalls).
2.  **Application Layer**: Polar Gateway audits and enforces allowed destinations per capability.
