// ============================================================
// devices.js — الأجهزة الموثوقة
// ============================================================

import { successResponse, errorResponse } from '../lib/response.js';
import { FirestoreClient } from '../lib/firestore-rest.js';

export async function handleDevices(request, env, headers) {
  const url = new URL(request.url);
  const path = url.pathname.replace('/api/devices', '');
  const method = request.method;

  if (path === '/check' && method === 'POST') return await checkDevice(request, env, headers);
  if (path === '/approve' && method === 'POST') return await approveDevice(request, env, headers);
  if (path === '/reject' && method === 'POST') return await rejectDevice(request, env, headers);
  if (path === '/pending' && method === 'GET') return await listPending(request, env, headers);

  return errorResponse('Unknown device endpoint', 404, headers);
}

async function checkDevice(request, env, headers) {
  const body = await request.json().catch(() => null);
  const { deviceId, deviceInfo } = body || {};

  if (!deviceId) return errorResponse('deviceId required', 400, headers);

  const fs = new FirestoreClient(env);
  const userDoc = await fs.getDoc('users', request.user.uid);
  if (!userDoc) return errorResponse('User not found', 404, headers);

  const trustedDevices = userDoc.trustedDevices || [];
  const isTrusted = trustedDevices.some(d => d.id === deviceId);

  if (isTrusted) {
    const updated = trustedDevices.map(d =>
      d.id === deviceId ? { ...d, lastSeen: new Date().toISOString() } : d
    );
    await fs.updateDoc('users', request.user.uid, { trustedDevices: updated });

    // تسجيل في سجل الدخول
    await logLogin(fs, request.user.uid, userDoc.phone, deviceId, deviceInfo);

    return successResponse({ trusted: true }, headers);
  }

  const reqId = 'DR' + Date.now();
  await fs.setDoc('device_requests', reqId, {
    id: reqId,
    userId: request.user.uid,
    userPhone: userDoc.phone,
    deviceId,
    deviceInfo: deviceInfo || {},
    status: 'pending',
    createdAt: new Date()
  });

  return successResponse({
    trusted: false,
    requestId: reqId,
    message: 'تم إنشاء طلب موافقة'
  }, headers);
}

async function approveDevice(request, env, headers) {
  const body = await request.json().catch(() => null);
  const { requestId } = body || {};
  if (!requestId) return errorResponse('requestId required', 400, headers);

  const fs = new FirestoreClient(env);
  const req = await fs.getDoc('device_requests', requestId);
  if (!req) return errorResponse('Request not found', 404, headers);
  if (req.userId !== request.user.uid) return errorResponse('Unauthorized', 403, headers);
  if (req.status !== 'pending') return errorResponse('Already processed', 400, headers);

  const userDoc = await fs.getDoc('users', request.user.uid);
  const trustedDevices = userDoc.trustedDevices || [];
  trustedDevices.push({
    id: req.deviceId,
    info: req.deviceInfo,
    addedAt: new Date().toISOString()
  });

  await fs.updateDoc('users', request.user.uid, { trustedDevices });
  await fs.updateDoc('device_requests', requestId, {
    status: 'approved',
    approvedAt: new Date()
  });

  return successResponse({ message: 'تم اعتماد الجهاز' }, headers);
}

async function rejectDevice(request, env, headers) {
  const body = await request.json().catch(() => null);
  const { requestId } = body || {};
  if (!requestId) return errorResponse('requestId required', 400, headers);

  const fs = new FirestoreClient(env);
  const req = await fs.getDoc('device_requests', requestId);
  if (!req || req.userId !== request.user.uid) return errorResponse('Unauthorized', 403, headers);

  await fs.updateDoc('device_requests', requestId, {
    status: 'rejected',
    rejectedAt: new Date()
  });

  return successResponse({ message: 'تم رفض الجهاز' }, headers);
}

async function listPending(request, env, headers) {
  const fs = new FirestoreClient(env);
  const list = await fs.query('device_requests', [
    { field: 'userId', op: '==', value: request.user.uid },
    { field: 'status', op: '==', value: 'pending' }
  ], 10);

  return successResponse({ requests: list }, headers);
}

async function logLogin(fs, uid, phone, deviceId, deviceInfo) {
  try {
    await fs.setDoc('login_history', 'LH' + Date.now(), {
      uid,
      userPhone: phone,
      deviceId,
      deviceName: deviceInfo?.platform || 'Unknown',
      location: 'Unknown',
      timestamp: new Date()
    });
  } catch (e) {
    console.warn('Login log failed:', e);
  }
}
