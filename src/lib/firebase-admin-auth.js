// ============================================================
// firebase-admin-auth.js — مصادقة Google APIs
// ============================================================

import { SignJWT, importPKCS8 } from 'jose';

let ACCESS_TOKEN_CACHE = null;
let ACCESS_TOKEN_EXPIRY = 0;

async function createGoogleJWT(serviceAccount, scopes) {
  const privateKey = await importPKCS8(serviceAccount.private_key, 'RS256');

  const now = Math.floor(Date.now() / 1000);
  const payload = {
    iss: serviceAccount.client_email,
    scope: scopes.join(' '),
    aud: 'https://oauth2.googleapis.com/token',
    iat: now,
    exp: now + 3600
  };

  return await new SignJWT(payload)
    .setProtectedHeader({ alg: 'RS256', typ: 'JWT' })
    .sign(privateKey);
}

export async function getGoogleAccessToken(serviceAccount, scopes = [
  'https://www.googleapis.com/auth/datastore',
  'https://www.googleapis.com/auth/identitytoolkit'
]) {
  const now = Date.now();
  if (ACCESS_TOKEN_CACHE && now < ACCESS_TOKEN_EXPIRY - 60000) {
    return ACCESS_TOKEN_CACHE;
  }

  const jwt = await createGoogleJWT(serviceAccount, scopes);

  const response = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer',
      assertion: jwt
    })
  });

  if (!response.ok) {
    const error = await response.text();
    throw new Error(`Failed to get access token: ${error}`);
  }

  const data = await response.json();
  ACCESS_TOKEN_CACHE = data.access_token;
  ACCESS_TOKEN_EXPIRY = now + (data.expires_in * 1000);

  return ACCESS_TOKEN_CACHE;
}

export function getServiceAccount(env) {
  if (!env.FIREBASE_SERVICE_ACCOUNT) {
    throw new Error('FIREBASE_SERVICE_ACCOUNT secret is not set');
  }
  try {
    return JSON.parse(env.FIREBASE_SERVICE_ACCOUNT);
  } catch (e) {
    throw new Error('Invalid FIREBASE_SERVICE_ACCOUNT JSON');
  }
    }
