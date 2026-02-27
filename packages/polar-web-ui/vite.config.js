import { defineConfig } from 'vite';
import { createControlPlaneService } from '../polar-control-plane/src/index.mjs';
import {
    createSqliteSchedulerStateStore,
    createSqliteBudgetStateStore,
    createSqliteMemoryProvider
} from '../polar-runtime-core/src/index.mjs';
import Database from 'better-sqlite3';
import { resolve, relative, normalize } from 'path';
import fs from 'fs/promises';

const dbPath = resolve(process.cwd(), '../../polar-system.db');
const db = new Database(dbPath);

const controlPlane = createControlPlaneService({
    schedulerStateStore: createSqliteSchedulerStateStore({ db }),
    budgetStateStore: createSqliteBudgetStateStore({ db }),
    memoryProvider: createSqliteMemoryProvider({ db })
});

// BUG-002 fix: API authorization via a simple bearer token from env
const API_SECRET = process.env.POLAR_UI_API_SECRET || null;

// BUG-003 fix: Allowlisted filenames for readMD/writeMD
const ALLOWED_MD_FILES = new Set([
    'AGENTS.md',
    'SKILLS.md',
    'MEMORY.md',
    'REACTIONS.md',
    'HEARTBEAT.md',
]);

// BUG-002 fix: Allowlisted control plane methods to prevent arbitrary method invocation
const ALLOWED_ACTIONS = new Set([
    'health',
    'upsertConfig', 'getConfig', 'listConfigs',
    'checkInitialBudget', 'upsertBudgetPolicy', 'getBudgetPolicy',
    'resolveProfile',
    'normalizeIngress', 'checkIngressHealth',
    'appendMessage', 'listSessions', 'getSessionHistory', 'searchMessages', 'applySessionRetentionPolicy',
    'upsertTask', 'transitionTask', 'listTasks', 'listTaskEvents', 'replayTaskRunLinks',
    'listHandoffRoutingTelemetry', 'listUsageTelemetry', 'listTelemetryAlerts', 'routeTelemetryAlerts',
    'listSchedulerEventQueue', 'runSchedulerQueueAction',
    'generateOutput', 'listModels', 'streamOutput', 'embedText',
    'executeExtension', 'applyExtensionLifecycle', 'listExtensionStates',
    'installSkill', 'syncMcpServer', 'installPlugin',
    'searchMemory', 'getMemory', 'upsertMemory', 'compactMemory',
]);

/**
 * BUG-003 fix: Validate that a filename is in the allowlist and doesn't traverse
 * @param {string} filename
 * @returns {string} resolved safe path
 */
function validateMdFilename(filename) {
    if (typeof filename !== 'string' || filename.length === 0) {
        throw new Error('filename must be a non-empty string');
    }

    // Normalize and extract just the basename to prevent path traversal
    const normalized = normalize(filename).replace(/^(\.\.(\/|\\|$))+/, '');
    const basename = normalized.split(/[/\\]/).pop();

    // Ensure the basename (with forced .md extension) is in the allowlist
    const finalName = basename.endsWith('.md') ? basename : `${basename}.md`;
    if (!ALLOWED_MD_FILES.has(finalName)) {
        throw new Error(`File "${finalName}" is not in the allowed files list`);
    }

    const projectRoot = resolve(process.cwd(), '../../');
    const resolvedPath = resolve(projectRoot, finalName);

    // Double-check the resolved path stays within the project root
    const rel = relative(projectRoot, resolvedPath);
    if (rel.startsWith('..') || resolve(projectRoot, rel) !== resolvedPath) {
        throw new Error('Path traversal detected');
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
                                        // BUG-003 fix: Validate filename against allowlist
                                        const filePath = validateMdFilename(payload.filename);
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
                                        // BUG-003 fix: Validate filename against allowlist
                                        const filePath = validateMdFilename(payload.filename);
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
