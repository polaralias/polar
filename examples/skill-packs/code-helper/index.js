const gatewayUrl = (process.env.POLAR_GATEWAY_URL || '').replace(/\/+$/, '');
const tokenList = (process.env.POLAR_AGENT_TOKEN || '')
  .split(',')
  .map((token) => token.trim())
  .filter((token) => token.length > 0);
const templateId = process.env.POLAR_WORKER_TEMPLATE_ID || 'summarize_directory';

let metadata = {};
try {
  metadata = JSON.parse(process.env.POLAR_AGENT_METADATA || '{}');
} catch {
  metadata = {};
}

const targetPath = (metadata.targetPath || metadata.path || process.cwd());

async function callGateway(action, payload) {
  for (const token of tokenList) {
    const response = await fetch(`${gatewayUrl}/tools/${action}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ token, ...payload }),
    });
    if (response.ok) {
      return response.json();
    }
  }
  throw new Error(`No usable token available for ${action}`);
}

async function main() {
  if (!gatewayUrl) {
    throw new Error('POLAR_GATEWAY_URL is required');
  }

  if (templateId === 'generate_readme') {
    const result = await callGateway('fs.workflow', {
      action: 'generate_readme',
      path: targetPath,
      args: {},
    });
    console.log(JSON.stringify(result, null, 2));
    return;
  }

  const result = await callGateway('fs.workflow', {
    action: 'summarize_directory',
    path: targetPath,
    args: {},
  });
  console.log(JSON.stringify(result, null, 2));
}

main().catch((error) => {
  console.error(`Code Helper worker failed: ${error.message}`);
  process.exit(1);
});
