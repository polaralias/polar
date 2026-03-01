import { defineConfig } from 'vite';
import { createPolarPlatform } from '@polar/platform';
import { fileURLToPath } from 'url';
import { dirname, isAbsolute, normalize, relative, resolve } from 'path';
import fs from 'fs/promises';

const moduleDir = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(moduleDir, '../..');
const platform = createPolarPlatform({
    dbPath: resolve(repoRoot, 'polar-system.db')
});
const controlPlane = platform.controlPlane;

// BUG-002 fix: API authorization via a simple bearer token from env
const API_SECRET = process.env.POLAR_UI_API_SECRET || null;

// Explicit control-plane method allowlist for Web UI dispatch.
const ALLOWED_ACTIONS = new Set([
    'health',
    'upsertConfig', 'getConfig', 'listConfigs',
    'checkInitialBudget', 'upsertBudgetPolicy', 'getBudgetPolicy',
    'appendMessage', 'listSessions', 'getSessionHistory', 'searchMessages', 'applySessionRetentionPolicy',
    'upsertTask', 'transitionTask', 'listTasks', 'listTaskEvents', 'replayTaskRunLinks',
    'listHandoffRoutingTelemetry', 'listUsageTelemetry', 'listTelemetryAlerts', 'routeTelemetryAlerts',
    'listSchedulerEventQueue', 'runSchedulerQueueAction',
    'createAutomationJob', 'listAutomationJobs', 'updateAutomationJob', 'disableAutomationJob',
    'generateOutput', 'listModels', 'streamOutput', 'embedText',
    'executeExtension', 'applyExtensionLifecycle', 'listExtensionStates',
    'installSkill', 'reviewSkillInstallProposal', 'syncMcpServer', 'installPlugin',
    'submitSkillMetadataOverride', 'listBlockedSkills', 'listCapabilityAuthorityStates',
    'searchMemory', 'getMemory', 'upsertMemory', 'compactMemory',
    'getPersonalityProfile', 'getEffectivePersonality', 'upsertPersonalityProfile', 'resetPersonalityProfile', 'listPersonalityProfiles',
    'getModelRegistry', 'upsertModelRegistry', 'setModelRegistryDefault',
    'orchestrate', 'updateMessageChannelId', 'executeWorkflow', 'rejectWorkflow', 'handleRepairSelection'
]);

/**
 * Validate markdown file paths for read/write operations.
 * Allow:
 * - AGENTS.md (root, read/write)
 * - docs/**/*.md (read/write)
 * - artifacts/**/*.md (read-only)
 * Reject absolute paths, traversal, and non-markdown files.
 * @param {string} filename
 * @param {"read"|"write"} mode
 * @returns {string} resolved safe path
 */
function validateMdFilename(filename, mode) {
    if (typeof filename !== 'string' || filename.trim().length === 0) {
        throw new Error('filename must be a non-empty string');
    }
    if (mode !== 'read' && mode !== 'write') {
        throw new Error('invalid markdown file mode');
    }
    if (filename.includes('\0')) {
        throw new Error('invalid filename');
    }
    if (isAbsolute(filename)) {
        throw new Error('absolute paths are not allowed');
    }

    const normalizedPath = normalize(filename).replace(/\\/g, '/');
    if (
        normalizedPath === '..' ||
        normalizedPath.startsWith('../') ||
        normalizedPath.includes('/../')
    ) {
        throw new Error('path traversal detected');
    }
    if (!normalizedPath.endsWith('.md')) {
        throw new Error('only .md files are allowed');
    }

    let pathGroup = '';
    if (normalizedPath === 'AGENTS.md') {
        pathGroup = 'root';
    } else if (normalizedPath.startsWith('docs/')) {
        pathGroup = 'docs';
    } else if (normalizedPath.startsWith('artifacts/')) {
        pathGroup = 'artifacts';
    } else {
        throw new Error('file path is not allowlisted');
    }

    if (mode === 'write' && pathGroup === 'artifacts') {
        throw new Error('artifacts markdown files are read-only');
    }

    const resolvedPath = resolve(repoRoot, normalizedPath);
    const rel = relative(repoRoot, resolvedPath).replace(/\\/g, '/');
    if (rel.startsWith('..') || isAbsolute(rel)) {
        throw new Error('resolved path escapes repository root');
    }

    if (pathGroup === 'docs' && !rel.startsWith('docs/')) {
        throw new Error('resolved docs path is invalid');
    }
    if (pathGroup === 'artifacts' && !rel.startsWith('artifacts/')) {
        throw new Error('resolved artifacts path is invalid');
    }

    return resolvedPath;
}

export default defineConfig({
    server: {
        port: 5173,
        host: true,
    },
    plugins: [
        {
            name: 'polar-api-plugin',
            configureServer(server) {
                server.middlewares.use(async (req, res, next) => {
                    if (!req.url.startsWith('/api/')) {
                        return next();
                    }

                    // BUG-002 fix: Check authorization if API_SECRET is configured
                    if (API_SECRET) {
                        const authHeader = req.headers['authorization'] || '';
                        const token = authHeader.startsWith('Bearer ') ? authHeader.slice(7) : '';
                        if (token !== API_SECRET) {
                            res.statusCode = 401;
                            res.end(JSON.stringify({ error: 'Unauthorized: invalid or missing API secret' }));
                            return;
                        }
                    }

                    const action = req.url.slice('/api/'.length).split('?')[0];

                    if (req.method === 'POST') {
                        let body = '';
                        req.on('data', chunk => { body += chunk.toString(); });
                        req.on('end', async () => {
                            try {
                                const payload = body ? JSON.parse(body) : {};

                                // Custom routes for MD File editing
                                if (action === 'readMD') {
                                    try {
                                        const filePath = validateMdFilename(payload.filename, 'read');
                                        const content = await fs.readFile(filePath, 'utf-8');
                                        res.setHeader('Content-Type', 'application/json');
                                        res.end(JSON.stringify({ content }));
                                    } catch (err) {
                                        res.setHeader('Content-Type', 'application/json');
                                        res.end(JSON.stringify({ content: '', error: err.message }));
                                    }
                                    return;
                                }

                                if (action === 'writeMD') {
                                    try {
                                        const filePath = validateMdFilename(payload.filename, 'write');
                                        await fs.writeFile(filePath, payload.content || '', 'utf-8');
                                        res.setHeader('Content-Type', 'application/json');
                                        res.end(JSON.stringify({ status: 'ok' }));
                                    } catch (err) {
                                        res.statusCode = 400;
                                        res.end(JSON.stringify({ error: err.message }));
                                    }
                                    return;
                                }

                                // BUG-002 fix: Only allow explicitly allowlisted actions
                                if (!ALLOWED_ACTIONS.has(action)) {
                                    res.statusCode = 403;
                                    res.end(JSON.stringify({ error: `Action "${action}" is not permitted` }));
                                    return;
                                }

                                if (typeof controlPlane[action] === 'function') {
                                    const result = await controlPlane[action](payload);
                                    res.setHeader('Content-Type', 'application/json');
                                    res.end(JSON.stringify(result));
                                } else {
                                    res.statusCode = 404;
                                    res.end(JSON.stringify({ error: `Action ${action} not found` }));
                                }
                            } catch (err) {
                                res.statusCode = 500;
                                res.end(JSON.stringify({ error: err.message }));
                            }
                        });
                        return;
                    }

                    // Handle GET
                    if (!ALLOWED_ACTIONS.has(action)) {
                        res.statusCode = 403;
                        res.end(JSON.stringify({ error: `Action "${action}" is not permitted` }));
                        return;
                    }

                    if (typeof controlPlane[action] === 'function') {
                        try {
                            const result = await controlPlane[action]({});
                            res.setHeader('Content-Type', 'application/json');
                            res.end(JSON.stringify(result));
                        } catch (err) {
                            res.statusCode = 500;
                            res.end(JSON.stringify({ error: err.message }));
                        }
                    } else {
                        res.statusCode = 404;
                        res.end(JSON.stringify({ error: `Action ${action} not found` }));
                    }
                });
            }
        }
    ],
});
