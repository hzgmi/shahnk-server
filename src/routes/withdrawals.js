// ============================================================
// withdrawals.js — طلبات السحب
// ============================================================

import { successResponse, errorResponse, checkRateLimit } from '../lib/response.js';
import { FirestoreClient } from '../lib/firestore-rest.js';

export async function handleWithdrawals(request, env, headers) {
  const url = new URL(request.url);
  const path = url.pathname.replace('/api/withdrawals', '');
  const method = request.method;

  if (path === '/create' && method === 'POST') {
    return await createWithdrawal(request, env, headers);
  }

  if (path === '/my' && method === 'GET') {
    return await myWithdrawals(request, env, headers);
  }

  return errorResponse('Unknown withdrawals endpoint', 404, headers);
}

async function createWithdrawal(request, env, headers) {
  const body = await request.json().catch(() => null);
  const { amount, method, account, name } = body || {};

  if (!amount || amount < 500 || amount > 500000) {
    return errorResponse('مبلغ غير صحيح (500-500,000)', 400, headers);
  }
  if (!method) return errorResponse('طريقة السحب مطلوبة', 400, headers);
  if (!account) return errorResponse('رقم الحساب مطلوب', 400, headers);
  if (!name) return errorResponse('اسم صاحب الحساب مطلوب', 400, headers);

  const allowed = await checkRateLimit(env, `withdraw:${request.user.uid}`, 3, 3600);
  if (!allowed) return errorResponse('محاولات كثيرة', 429, headers);

  const fs = new FirestoreClient(env);
  const userDoc = await fs.getDoc('users', request.user.uid);

  if ((userDoc.balance || 0) < amount) {
    return errorResponse(`الرصيد غير كافٍ. رصيدك: ${userDoc.balance}`, 400, headers);
  }

  const reqId = 'WDR' + Date.now();
  await fs.setDoc('withdrawal_requests', reqId, {
    id: reqId,
    uid: request.user.uid,
    userName: userDoc.name,
    userPhone: userDoc.phone,
    amount,
    method,
    account,
    name,
    status: 'pending',
    createdAt: new Date()
  });

  // إشعار للأدمن
  await fs.setDoc('notifications', 'N' + Date.now(), {
    forAdmin: true,
    icon: 'fa-money-bill-transfer',
    color: 'linear-gradient(145deg, #ffc72c, #ff6b35)',
    title: '💸 طلب سحب جديد',
    message: `${userDoc.name} — ${amount} ريال`,
    type: 'withdrawal_request',
    requestId: reqId,
    read: false,
    createdAt: new Date()
  });

  return successResponse({
    message: 'تم إرسال الطلب',
    requestId: reqId
  }, headers);
}

async function myWithdrawals(request, env, headers) {
  const fs = new FirestoreClient(env);
  const list = await fs.query('withdrawal_requests',
    [{ field: 'uid', op: '==', value: request.user.uid }],
    50
  );
  return successResponse({ withdrawals: list }, headers);
}
