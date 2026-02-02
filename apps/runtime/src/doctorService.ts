import fs from 'node:fs/promises';
import { constants as fsConstants } from 'node:fs';
import { PolicyStoreSchema } from '@polar/core';
import { runtimeConfig } from './config.js';
import { listAgents } from './agentStore.js';

export type DoctorResult = {
    id: string;
    name: string;
    status: 'OK' | 'WARNING' | 'CRITICAL';
    message: string;
    remediation?: string;
};

export async function runDiagnostics(): Promise<DoctorResult[]> {
    const results: DoctorResult[] = [];

    // 1. Signing Key Check
    try {
        await fs.access(runtimeConfig.signingKeyPath, fsConstants.R_OK);
        results.push({
            id: 'signing_key',
            name: 'Signing Key Health',
            status: 'OK',
            message: 'Signing key is present and readable.',
        });
    } catch {
        results.push({
            id: 'signing_key',
            name: 'Signing Key Health',
            status: 'CRITICAL',
            message: 'Signing key is missing or unreadable.',
            remediation: 'Run "polar init" to generate a new signing key.',
        });
    }

    // 1b. Master Key Check
    if (process.env.POLAR_MASTER_KEY) {
        results.push({
            id: 'master_key',
            name: 'Master Key Health',
            status: 'OK',
            message: 'Master key provided via environment variable.',
        });
    } else {
        try {
            await fs.access(runtimeConfig.masterKeyPath, fsConstants.R_OK);
            results.push({
                id: 'master_key',
                name: 'Master Key Health',
                status: 'OK',
                message: 'Master key file is present and readable.',
            });
        } catch {
            results.push({
                id: 'master_key',
                name: 'Master Key Health',
                status: 'WARNING',
                message: 'Master key file is missing (will be generated on use).',
                remediation: 'Ensure data directory is writable.',
            });
        }
    }

    // 2. Audit Log Check
    try {
        await fs.access(runtimeConfig.auditPath, fsConstants.W_OK);
        results.push({
            id: 'audit_log',
            name: 'Audit Log Health',
            status: 'OK',
            message: 'Audit log is writable.',
        });
    } catch {
        results.push({
            id: 'audit_log',
            name: 'Audit Log Health',
            status: 'CRITICAL',
            message: 'Audit log is not writable or missing.',
            remediation: 'Check permissions for ' + runtimeConfig.auditPath,
        });
    }

    // 3. Policy Integrity Check
    try {
        const raw = await fs.readFile(runtimeConfig.policyPath, 'utf-8');
        const policy = JSON.parse(raw);
        const parsed = PolicyStoreSchema.safeParse(policy);
        if (!parsed.success) {
            results.push({
                id: 'policy_integrity',
                name: 'Policy Integrity',
                status: 'CRITICAL',
                message: 'Policy file is malformed.',
                remediation: 'Restore policy file from backup or re-initialize.',
            });
        } else {
            // Check for deny-by-default (no catch-all allow rules)
            const hasWildcardAllow = policy.grants.some((g: any) =>
                g.subject === '*' && g.action === '*' && g.resource.type === '*'
            );
            if (hasWildcardAllow) {
                results.push({
                    id: 'policy_integrity',
                    name: 'Policy Integrity',
                    status: 'WARNING',
                    message: 'Policy contains a wildcard allow-all grant.',
                    remediation: 'Remove wildcard grants to restore deny-by-default security.',
                });
            } else {
                results.push({
                    id: 'policy_integrity',
                    name: 'Policy Integrity',
                    status: 'OK',
                    message: 'Policy follows deny-by-default principle.',
                });
            }
        }
    } catch {
        results.push({
            id: 'policy_integrity',
            name: 'Policy Integrity',
            status: 'CRITICAL',
            message: 'Policy file missing or unreadable.',
            remediation: 'Run "polar init" to create a default policy.',
        });
    }

    // 4. Gateway Health
    try {
        const response = await fetch(`${runtimeConfig.gatewayUrl}/health`);
        if (response.ok) {
            results.push({
                id: 'gateway_health',
                name: 'Gateway Connectivity',
                status: 'OK',
                message: 'Gateway is reachable and healthy.',
            });
        } else {
            results.push({
                id: 'gateway_health',
                name: 'Gateway Connectivity',
                status: 'CRITICAL',
                message: `Gateway returned status ${response.status}.`,
                remediation: 'Check gateway logs and ensure it is running.',
            });
        }
    } catch {
        results.push({
            id: 'gateway_health',
            name: 'Gateway Connectivity',
            status: 'CRITICAL',
            message: 'Gateway is unreachable.',
            remediation: 'Start the gateway service.',
        });
    }

    // 5. Environment Profile Check
    results.push({
        id: 'deployment_profile',
        name: 'Deployment Profile',
        status: 'OK',
        message: `Running with profile: ${runtimeConfig.deploymentProfile}`,
    });

    // 6. Secrets Backend Check
    try {
        await fs.access(runtimeConfig.secretsPath, fsConstants.R_OK | fsConstants.W_OK);
        results.push({
            id: 'secrets_backend',
            name: 'Secrets Backend',
            status: 'OK',
            message: 'Secrets store is reachable and writable.',
        });
    } catch {
        // Warning instead of critical if it doesn't exist yet but directory is writable
        try {
            await fs.access(runtimeConfig.dataDir, fsConstants.W_OK);
            results.push({
                id: 'secrets_backend',
                name: 'Secrets Backend',
                status: 'OK',
                message: 'Secrets store not yet created, but data directory is writable.',
            });
        } catch {
            results.push({
                id: 'secrets_backend',
                name: 'Secrets Backend',
                status: 'CRITICAL',
                message: 'Secrets store is unreachable and data directory is not writable.',
                remediation: `Ensure ${runtimeConfig.dataDir} exists and is writable.`,
            });
        }
    }

    // 7. Clock Skew Check
    try {
        const start = Date.now();
        // Use a reliable public NTP/Time API or just check if system time makes sense
        // For a simple check, we'll just verify the local clock isn't wildly in the past
        // Check if system time is after the build/release date of this version
        const MIN_VALID_TIME = 1738435200000; // 2026-02-01
        if (start < MIN_VALID_TIME) {
            results.push({
                id: 'clock_skew',
                name: 'Clock Integrity',
                status: 'CRITICAL',
                message: 'System clock appears to be set in the past.',
                remediation: 'Synchronize system clock with NTP.',
            });
        } else {
            results.push({
                id: 'clock_skew',
                name: 'Clock Integrity',
                status: 'OK',
                message: 'Clock appears within normal range.',
            });
        }
    } catch {
        // ignore
    }

    // 8. Orphaned Agents
    try {
        const agents = listAgents();
        if (agents.length > 50) {
            results.push({
                id: 'orphaned_agents',
                name: 'Agent Resources',
                status: 'WARNING',
                message: `High number of active agents (${agents.length}).`,
                remediation: 'Terminate unused agents to free up resources.',
            });
        } else {
            results.push({
                id: 'orphaned_agents',
                name: 'Agent Resources',
                status: 'OK',
                message: 'Agent count is within normal limits.',
            });
        }
    } catch {
        // ignore
    }

    // 9. Audit Chain Verification
    try {
        const fileHandle = await fs.open(runtimeConfig.auditPath, 'r');
        try {
            // In a real scenario, we might scan the whole file or the last N records.
            // Scanning the *whole* file can be slow, but it's the only way to prove integrity.
            const content = await fs.readFile(runtimeConfig.auditPath, 'utf-8');
            const lines = content.trim().split('\n');

            let previousHash = '0'.repeat(64);
            let broken = false;

            if (lines.length > 0 && lines[0] !== '') {
                const crypto = (await import('node:crypto')).default;
                for (let i = 0; i < lines.length; i++) {
                    try {
                        const line = lines[i];
                        if (!line || !line.trim()) continue;
                        const event = JSON.parse(line);

                        if (event.previousHash !== previousHash) {
                            broken = true;
                            results.push({
                                id: 'audit_integrity',
                                name: 'Audit Chain Verification',
                                status: 'CRITICAL',
                                message: `Chain broken at line ${i + 1}. Expected previousHash ${previousHash.slice(0, 8)}..., got ${event.previousHash?.slice(0, 8)}...`,
                                remediation: 'Investigate potential tamper attempt.'
                            });
                            break;
                        }

                        // Recompute hash
                        const { hash, previousHash: p, ...rest } = event;
                        const recordToHash = { ...rest, previousHash }; // Standardize order if needed, but JSON.stringify is order-dependent
                        // Our appendAudit uses consistent object construction.
                        // Ideally we'd use canonical-json. For now, rely on identical reconstruction.

                        const contentString = JSON.stringify(recordToHash);
                        const computedHash = crypto.createHash('sha256').update(contentString).digest('hex');

                        if (computedHash !== hash) {
                            broken = true;
                            results.push({
                                id: 'audit_integrity',
                                name: 'Audit Chain Verification',
                                status: 'CRITICAL',
                                message: `Hash mismatch at line ${i + 1}.`,
                                remediation: 'Investigate potential tamper attempt.'
                            });
                            break;
                        }

                        previousHash = hash;
                    } catch (e) {
                        broken = true;
                        results.push({
                            id: 'audit_integrity',
                            name: 'Audit Chain Verification',
                            status: 'CRITICAL',
                            message: `Malformed JSON at line ${i + 1}.`,
                        });
                        break;
                    }
                }
            }

            if (!broken) {
                results.push({
                    id: 'audit_integrity',
                    name: 'Audit Chain Verification',
                    status: 'OK',
                    message: 'Audit chain is intact.',
                });
            }
        } finally {
            await fileHandle.close();
        }
    } catch (e) {
        if ((e as NodeJS.ErrnoException).code !== 'ENOENT') {
            results.push({
                id: 'audit_integrity',
                name: 'Audit Chain Verification',
                status: 'WARNING',
                message: 'Could not read audit log for verification.',
            });
        }
    }

    // 10. File Permissions
    const filesToCheck = [
        { path: runtimeConfig.signingKeyPath, name: 'Signing Key' },
        { path: runtimeConfig.masterKeyPath, name: 'Master Key' },
        { path: runtimeConfig.secretsPath, name: 'Secrets Store' },
    ];

    for (const f of filesToCheck) {
        try {
            const stats = await fs.stat(f.path);
            const mode = stats.mode & 0o777;
            // 0o600 (rw-------) is ideal. 0o644 (rw-r--r--) is acceptable for now but suboptimal for secrets.
            // On Windows, permissions are tricky but Node approximates them.
            if (process.platform !== 'win32' && (mode & 0o077)) {
                results.push({
                    id: 'file_permissions',
                    name: 'File Permissions',
                    status: 'WARNING',
                    message: `${f.name} is accessible by group/others (${mode.toString(8)}).`,
                    remediation: `Run "chmod 600 ${f.path}"`
                });
            }
        } catch {
            // Ignore missing files, handled by other checks
        }
    }

    // 11. Security Config
    if (runtimeConfig.deploymentProfile !== 'local') {
        if (runtimeConfig.bindAddress === '0.0.0.0') {
            results.push({
                id: 'security_config',
                name: 'Network Security',
                status: 'WARNING',
                message: 'Binding to 0.0.0.0 in non-local profile requires strict authentication.',
                remediation: 'Ensure authentication middleware is active.'
            });
        }
        if (runtimeConfig.internalSecret === 'polar-dev-secret-123') {
            results.push({
                id: 'security_config',
                name: 'Internal Secret',
                status: 'CRITICAL',
                message: 'Default internal secret detected in non-local profile.',
                remediation: 'Set POLAR_INTERNAL_SECRET env var.'
            });
        }
    }

    return results;
}
