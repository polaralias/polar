import { SignJWT, jwtVerify, type KeyLike } from 'jose';
import {
  Capability,
  CapabilityTokenPayload,
  CapabilityTokenPayloadSchema,
} from './schemas.js';

export type SigningKey = KeyLike | Uint8Array;

export async function mintCapabilityToken(
  capability: Capability,
  signingKey: SigningKey,
): Promise<string> {
  const payload = {
    act: capability.action,
    res: capability.resource,
    fld: capability.fields,
  };

  return new SignJWT(payload)
    .setProtectedHeader({ alg: 'HS256', typ: 'JWT' })
    .setSubject(capability.subject)
    .setExpirationTime(capability.expiresAt)
    .setJti(capability.id)
    .sign(signingKey);
}

export async function verifyCapabilityToken(
  token: string,
  signingKey: SigningKey,
): Promise<CapabilityTokenPayload> {
  const { payload } = await jwtVerify(token, signingKey, {
    algorithms: ['HS256'],
  });

  const parsed = CapabilityTokenPayloadSchema.safeParse({
    sub: payload.sub,
    act: payload.act,
    res: payload.res,
    fld: payload.fld,
    exp: payload.exp,
    jti: payload.jti,
  });

  if (!parsed.success) {
    throw new Error('Invalid capability token payload');
  }

  return parsed.data;
}
