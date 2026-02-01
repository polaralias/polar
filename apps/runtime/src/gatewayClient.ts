import { runtimeConfig } from './config.js';

export type GatewayResponse = {
  ok: boolean;
  status: number;
  data?: unknown;
  error?: string;
};

export async function callGatewayTool(
  action: 'fs.readFile' | 'fs.listDir',
  token: string,
  path: string,
): Promise<GatewayResponse> {
  const response = await fetch(`${runtimeConfig.gatewayUrl}/tools/${action}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ token, path }),
  });

  const contentType = response.headers.get('content-type') ?? '';
  let data: unknown = undefined;
  if (contentType.includes('application/json')) {
    data = await response.json();
  } else {
    data = await response.text();
  }

  if (!response.ok) {
    return {
      ok: false,
      status: response.status,
      error: typeof data === 'string' ? data : (data as { error?: string })?.error,
      data,
    };
  }

  return { ok: true, status: response.status, data };
}
