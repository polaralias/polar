import fs from 'node:fs/promises';
import { constants as fsConstants } from 'node:fs';
import { gatewayConfig } from './config.js';

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
        await fs.access(gatewayConfig.signingKeyPath, fsConstants.R_OK);
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
            remediation: 'Ensure signing key exists at ' + gatewayConfig.signingKeyPath,
        });
    }

    // 2. Runtime Connectivity
    try {
        const response = await fetch(`${gatewayConfig.runtimeUrl}/health`);
        if (response.ok) {
            results.push({
                id: 'runtime_health',
                name: 'Runtime Connectivity',
                status: 'OK',
                message: 'Runtime is reachable and healthy.',
            });
        } else {
            results.push({
                id: 'runtime_health',
                name: 'Runtime Connectivity',
                status: 'WARNING',
                message: `Runtime returned status ${response.status}.`,
                remediation: 'Ensure the runtime service is running.',
            });
        }
    } catch {
        results.push({
            id: 'runtime_health',
            name: 'Runtime Connectivity',
            status: 'WARNING',
            message: 'Runtime is unreachable.',
            remediation: 'Start the runtime service.',
        });
    }

    // 3. Introspection Endpoint Check
    try {
        const response = await fetch(`${gatewayConfig.runtimeUrl}/internal/introspect`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'x-polar-internal-secret': gatewayConfig.internalSecret,
            },
            body: JSON.stringify({ token: 'test' }),
        });
        // A 401 means the endpoint is protecting itself correctly (bad token)
        if (response.status === 401 || response.status === 200) {
            results.push({
                id: 'introspection_health',
                name: 'Introspection Service',
                status: 'OK',
                message: 'Introspection endpoint is functional.',
            });
        } else {
            results.push({
                id: 'introspection_health',
                name: 'Introspection Service',
                status: 'WARNING',
                message: `Introspection endpoint returned unexpected status ${response.status}.`,
                remediation: 'Check runtime introspection endpoint configuration.',
            });
        }
    } catch {
        results.push({
            id: 'introspection_health',
            name: 'Introspection Service',
            status: 'WARNING',
            message: 'Introspection endpoint is unreachable.',
            remediation: 'Ensure runtime is running and internal secret is correctly configured.',
        });
    }

    // 4. Deployment Profile Check
    results.push({
        id: 'deployment_profile',
        name: 'Deployment Profile',
        status: 'OK',
        message: `Running with profile: ${gatewayConfig.deploymentProfile}`,
    });

    // 5. Security Configuration Checks (non-local profiles)
    if (gatewayConfig.deploymentProfile !== 'local') {
        if (gatewayConfig.bindAddress === '0.0.0.0') {
            results.push({
                id: 'security_config',
                name: 'Network Security',
                status: 'WARNING',
                message: 'Binding to 0.0.0.0 in non-local profile. Ensure proper network security.',
                remediation: 'Use firewall rules or reverse proxy for protection.',
            });
        }

        if (gatewayConfig.internalSecret === 'polar-dev-secret-123') {
            results.push({
                id: 'security_config',
                name: 'Internal Secret',
                status: 'CRITICAL',
                message: 'Default internal secret detected in non-local profile.',
                remediation: 'Set POLAR_INTERNAL_SECRET env var.',
            });
        }
    }

    // 6. Filesystem Base Directory Check
    try {
        await fs.access(gatewayConfig.fsBaseDir, fsConstants.R_OK);
        results.push({
            id: 'fs_base_dir',
            name: 'Filesystem Base Directory',
            status: 'OK',
            message: `Base directory ${gatewayConfig.fsBaseDir} is accessible.`,
        });
    } catch {
        results.push({
            id: 'fs_base_dir',
            name: 'Filesystem Base Directory',
            status: 'WARNING',
            message: `Base directory ${gatewayConfig.fsBaseDir} is not accessible.`,
            remediation: 'Ensure the directory exists and is readable.',
        });
    }

    return results;
}
