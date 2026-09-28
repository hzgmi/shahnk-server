// ============================================================
// index.js — نقطة دخول Cloudflare Worker
// ============================================================

import { handleAuth } from './routes/auth.js';
import { handleWallet } from './routes/wallet.js';
import { handleDeposits } from './routes/deposits.js';
import { handleWithdrawals } from './routes/withdrawals.js';
import { handleDevices } from './routes/devices.js';
import { handleNotifications } from './routes/notifications.js';
import { handleServices } from './routes/services.js';
import { handleCatalog } from './routes/catalog.js';
import { handleFlights } from './routes/flights.js';
import { jsonResponse, errorResponse } from './lib/response.js';
import { verifyFirebaseToken } from './lib/firebase-verify.js';

// ============================================================
// CORS
// ============================================================
function corsHeaders(origin) {
  const allowed = [
    'https://shahnk.netlify.app',
    'https://shahnk-admin.netlify.app',
    'https://shahnk.pages.dev',
    'http://localhost:3000',
    'http://localhost:5173',
    'http://localhost:5500',
    'http://127.0.0.1:5500',
    'capacitor://localhost',
    'http://localhost'
  ];

  const allowOrigin = allowed.includes(origin) || origin.startsWith('http://192.168.')
    ? origin
    : allowed[0];

  return {
    'Access-Control-Allow-Origin': allowOrigin,
    'Access-Control-Allow-Methods': 'GET, POST, PUT, DELETE, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type, Authorization, X-Device-Id',
    'Access-Control-Allow-Credentials': 'true',
    'Access-Control-Max-Age': '86400'
  };
}

// ============================================================
// Router الرئيسي
// ============================================================
export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);
    const origin = request.headers.get('Origin') || '';
    const cors = corsHeaders(origin);

    // Preflight
    if (request.method === 'OPTIONS') {
      return new Response(null, { status: 204, headers: cors });
    }

    // Security Headers
    const securityHeaders = {
      ...cors,
      'X-Content-Type-Options': 'nosniff',
      'X-Frame-Options': 'DENY',
      'Referrer-Policy': 'strict-origin-when-cross-origin'
    };

    try {
      // Health Check
      if (url.pathname === '/health') {
        return jsonResponse({
          status: 'ok',
          service: 'shahnk-api',
          timestamp: Date.now(),
          environment: env.ENVIRONMENT || 'production'
        }, securityHeaders);
      }

      // Public Routes
      if (url.pathname.startsWith('/api/auth/')) {
        return await handleAuth(request, env, securityHeaders);
      }

      // Protected Routes
      const authHeader = request.headers.get('Authorization') || '';
      if (!authHeader.startsWith('Bearer ')) {
        return errorResponse('Missing authorization token', 401, securityHeaders);
      }

      const idToken = authHeader.substring(7);
      const decoded = await verifyFirebaseToken(idToken, env.FIREBASE_PROJECT_ID);

      if (!decoded) {
        return errorResponse('Invalid or expired token', 401, securityHeaders);
      }

      request.user = decoded;
      request.deviceId = request.headers.get('X-Device-Id') || 'unknown';

      // Dispatch
      if (url.pathname.startsWith('/api/wallet/')) {
        return await handleWallet(request, env, securityHeaders);
      }
      if (url.pathname.startsWith('/api/deposits/')) {
        return await handleDeposits(request, env, securityHeaders);
      }
      if (url.pathname.startsWith('/api/withdrawals/')) {
        return await handleWithdrawals(request, env, securityHeaders);
      }
      if (url.pathname.startsWith('/api/devices/')) {
        return await handleDevices(request, env, securityHeaders);
      }
      if (url.pathname.startsWith('/api/notifications/')) {
        return await handleNotifications(request, env, securityHeaders);
      }
      if (url.pathname.startsWith('/api/services/')) {
        return await handleServices(request, env, securityHeaders);
      }
      if (url.pathname.startsWith('/api/catalog/')) {
        return await handleCatalog(request, env, securityHeaders);
      }
      if (url.pathname.startsWith('/api/flights/')) {
        return await handleFlights(request, env, securityHeaders);
      }

      return errorResponse('Endpoint not found', 404, securityHeaders);

    } catch (error) {
      console.error('[ERROR]', error.message, error.stack);
      return errorResponse(
        env.ENVIRONMENT === 'production' ? 'Internal error' : error.message,
        500,
        securityHeaders
      );
    }
  }
};
