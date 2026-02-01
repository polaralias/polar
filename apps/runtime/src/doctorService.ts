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

    return results;
}
