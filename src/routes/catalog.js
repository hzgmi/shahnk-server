// ============================================================
// catalog.js — الكتالوج
// ============================================================

import { successResponse, errorResponse } from '../lib/response.js';
import { FirestoreClient } from '../lib/firestore-rest.js';

export async function handleCatalog(request, env, headers) {
  const url = new URL(request.url);
  const path = url.pathname.replace('/api/catalog', '');
  const method = request.method;

  if (path === '' && method === 'GET') {
    const fs = new FirestoreClient(env);
    const list = await fs.query('service_catalog',
      [{ field: 'active', op: '==', value: true }],
      200
    );
    return successResponse({ services: list }, headers);
  }

  const match = path.match(/^\/([^\/]+)$/);
  if (match && method === 'GET') {
    const fs = new FirestoreClient(env);
    const service = await fs.getDoc('service_catalog', match[1]);
    if (!service || !service.active) {
      return errorResponse('Service not found', 404, headers);
    }
    return successResponse({ service }, headers);
  }

  return errorResponse('Unknown catalog endpoint', 404, headers);
      }
