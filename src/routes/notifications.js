// ============================================================
// notifications.js — الإشعارات
// ============================================================

import { successResponse, errorResponse } from '../lib/response.js';
import { FirestoreClient } from '../lib/firestore-rest.js';

export async function handleNotifications(request, env, headers) {
  const url = new URL(request.url);
  const path = url.pathname.replace('/api/notifications', '');
  const method = request.method;

  if (path === '' && method === 'GET') {
    const fs = new FirestoreClient(env);
    const list = await fs.query('notifications',
      [{ field: 'userId', op: '==', value: request.user.uid }],
      50
    );
    return successResponse({ notifications: list }, headers);
  }

  if (path === '/mark-read' && method === 'POST') {
    const body = await request.json().catch(() => null);
    if (!body || !body.notificationId) {
      return errorResponse('notificationId required', 400, headers);
    }

    const fs = new FirestoreClient(env);
    const notif = await fs.getDoc('notifications', body.notificationId);
    if (!notif || notif.userId !== request.user.uid) {
      return errorResponse('Not found', 404, headers);
    }

    await fs.updateDoc('notifications', body.notificationId, {
      read: true,
      readAt: new Date()
    });

    return successResponse({ message: 'marked as read' }, headers);
  }

  return errorResponse('Unknown notifications endpoint', 404, headers);
      }
