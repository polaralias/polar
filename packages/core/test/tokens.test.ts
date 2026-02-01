import { describe, expect, it } from 'vitest';
import { mintCapabilityToken, verifyCapabilityToken } from '../src/tokens.js';

const encoder = new TextEncoder();

function buildCapability(expiresAt: number) {
  return {
    id: 'cap-test',
    subject: 'worker-test',
    action: 'fs.readFile',
    resource: {
      type: 'fs',
      root: 'C:/sandbox/allowed',
      paths: ['C:/sandbox/allowed/a.txt'],
    },
    expiresAt,
  };
}

describe('capability tokens', () => {
  it('mints and verifies a token', async () => {
    const now = Math.floor(Date.now() / 1000);
    const token = await mintCapabilityToken(
      buildCapability(now + 60),
      encoder.encode('secret'),
    );

    const payload = await verifyCapabilityToken(token, encoder.encode('secret'));

    expect(payload.sub).toBe('worker-test');
    expect(payload.act).toBe('fs.readFile');
    expect(payload.res.type).toBe('fs');
  });

  it('rejects tampered tokens', async () => {
    const now = Math.floor(Date.now() / 1000);
    const token = await mintCapabilityToken(
      buildCapability(now + 60),
      encoder.encode('secret'),
    );
    const tampered = token.slice(0, -1) + (token.endsWith('a') ? 'b' : 'a');

    await expect(verifyCapabilityToken(tampered, encoder.encode('secret'))).rejects.toThrow();
  });

  it('rejects expired tokens', async () => {
    const now = Math.floor(Date.now() / 1000);
    const token = await mintCapabilityToken(
      buildCapability(now - 10),
      encoder.encode('secret'),
    );

    await expect(verifyCapabilityToken(token, encoder.encode('secret'))).rejects.toThrow();
  });
});
