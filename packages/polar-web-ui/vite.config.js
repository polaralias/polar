import { defineConfig } from 'vite';
import { createControlPlaneService } from '../polar-control-plane/src/index.mjs';

const controlPlane = createControlPlaneService();

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

                    const action = req.url.slice('/api/'.length).split('?')[0];

                    if (req.method === 'POST') {
                        let body = '';
                        req.on('data', chunk => { body += chunk.toString(); });
                        req.on('end', async () => {
                            try {
                                const payload = body ? JSON.parse(body) : {};
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
                                res.end(JSON.stringify({ error: err.message, stack: err.stack }));
                            }
                        });
                        return;
                    }

                    // Handle GET roughly by checking if function exists
                    if (typeof controlPlane[action] === 'function') {
                        try {
                            const result = await controlPlane[action]({});
                            res.setHeader('Content-Type', 'application/json');
                            res.end(JSON.stringify(result));
                        } catch (err) {
                            res.statusCode = 500;
                            res.end(JSON.stringify({ error: err.message, stack: err.stack }));
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
