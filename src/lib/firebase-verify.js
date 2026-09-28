// ============================================================
// firebase-verify.js — التحقق من Firebase ID Token
// ============================================================

import { createRemoteJWKSet, jwtVerify } from 'jose';

let JWKS_CACHE = null;
let JWKS_CACHE_TIME = 0;
const JWKS_TTL = 3600 * 1000;

function getJWKS() {
  const now = Date.now();
  if (JWKS_CACHE && (now - JWKS_CACHE_TIME) < JWKS_TTL) {
    return JWKS_CACHE;
  }

  JWKS_CACHE = createRemoteJWKSet(
    new URL('https://www.googleapis.com/service_accounts/v1/jwk/securetoken@system.gserviceaccount.com')
  );
  JWKS_CACHE_TIME = now;
  return JWKS_CACHE;
}

export async function verifyFirebaseToken(idToken, projectId) {
  try {
    const JWKS = getJWKS();

    const { payload } = await jwtVerify(idToken, JWKS, {
      issuer: `https://securetoken.google.com/${projectId}`,
      audience: projectId
    });

    if (!payload.sub || payload.sub.length > 128) {
      return null;
    }

    return {
      uid: payload.sub,
      email: payload.email || null,
      phone: payload.phone_number || null,
      emailVerified: payload.email_verified || false,
      authTime: payload.auth_time,
      iat: payload.iat,
      exp: payload.exp
    };
  } catch (error) {
    console.error('Token verification failed:', error.message);
    return null;
  }
      }
