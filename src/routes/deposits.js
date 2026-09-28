// ============================================================
// deposits.js — طلبات الإيداع
// ============================================================

import { successResponse, errorResponse, checkRateLimit } from '../lib/response.js';
import { FirestoreClient } from '../lib/firestore-rest.js';

export async function handleDeposits(request, env, headers) {
  const url = new URL(request.url);
  const path = url.pathname.replace('/api/deposits', '');
  const method = request.method;

  if (path === '/create' && method === 'POST') {
    return await createDeposit(request, env, headers);
  }

  if (path === '/my' && method === 'GET') {
    return await myDeposits(request, env, headers);
  }

  return errorResponse('Unknown deposits endpoint', 404, headers);
}

async function createDeposit(request, env, headers) {
  const body = await request.json().catch(() => null);
  const { amount, method, txNumber, notes } = body || {};

  if (!amount || amount < 100 || amount > 1000000) {
    return errorResponse('مبلغ غير صحيح (100-1,000,000)', 400, headers);
  }
  if (!method) return errorResponse('طريقة الدفع مطلوبة', 400, headers);
  if (!txNumber || txNumber.length < 4) return errorResponse('رقم العملية مطلوب', 400, headers);

  const allowed = await checkRateLimit(env, `deposit:${request.user.uid}`, 3, 3600);
  if (!allowed) return errorResponse('محاولات كثيرة', 429, headers);

  const fs = new FirestoreClient(env);
  const userDoc = await fs.getDoc('users', request.user.uid);

  const reqId = 'DEP' + Date.now();
  await fs.setDoc('deposit_requests', reqId, {
    id: reqId,
    uid: request.user.uid,
    userName: userDoc.name,
    userPhone: userDoc.phone,
    amount,
    method,
    txNumber,
    notes: notes || '',
    status: 'pending',
    createdAt: new Date()
  });

  // إشعار للأدمن
  await fs.setDoc('notifications', 'N' + Date.now(), {
    forAdmin: true,
    icon: 'fa-money-bill-wave',
    color: 'linear-gradient(145deg, #25e38c, #18bf75)',
    title: '💰 طلب إيداع جديد',
    message: `${userDoc.name} — ${amount} ريال`,
    type: 'deposit_request',
    requestId: reqId,
    read: false,
    createdAt: new Date()
  });

  return successResponse({
    message: 'تم إرسال الطلب',
    requestId: reqId
  }, headers);
}

async function myDeposits(request, env, headers) {
  const fs = new FirestoreClient(env);
  const list = await fs.query('deposit_requests',
    [{ field: 'uid', op: '==', value: request.user.uid }],
    50
  );
  return successResponse({ deposits: list }, headers);
    }
