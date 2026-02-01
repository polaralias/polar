import { runtimeConfig } from './config.js';

export type GatewayResponse = {
  ok: boolean;
  status: number;
  data?: unknown;
  error?: string;
};

export async function callGatewayTool(
  action: 'fs.readFile' | 'fs.listDir' | 'fs.writeFile',
  token: string,
  path: string,
  content?: string,
): Promise<GatewayResponse> {
  const response = await fetch(`${runtimeConfig.gatewayUrl}/tools/${action}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ token, path, content }),
  });

  const contentType = response.headers.get('content-type') ?? '';
  let data: unknown = undefined;
  if (contentType.includes('application/json')) {
    data = await response.json();
  } else {
    data = await response.text();
  }

  if (!response.ok) {
    const error = typeof data === 'string' ? data : (data as { error?: string })?.error;
    const result: GatewayResponse = {
      ok: false,
      status: response.status,
      data,
    };
    if (error) {
      result.error = error;
    }
    return result;
  }

  return { ok: true, status: response.status, data };
}
