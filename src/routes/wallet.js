// ============================================================
// wallet.js — العمليات المالية
// ============================================================

import { successResponse, errorResponse, checkRateLimit } from '../lib/response.js';
import { FirestoreClient } from '../lib/firestore-rest.js';

export async function handleWallet(request, env, headers) {
  const url = new URL(request.url);
  const path = url.pathname.replace('/api/wallet', '');
  const method = request.method;
  const user = request.user;

  if (path === '/balance' && method === 'GET') {
    const fs = new FirestoreClient(env);
    const userDoc = await fs.getDoc('users', user.uid);
    if (!userDoc) return errorResponse('User not found', 404, headers);
    return successResponse({
      balance: userDoc.balance || 0,
      accountNumber: userDoc.accountNumber
    }, headers);
  }

  if (path === '/transfer' && method === 'POST') {
    return await transferBalance(request, env, headers);
  }

  return errorResponse('Unknown wallet endpoint', 404, headers);
}

async function transferBalance(request, env, headers) {
  const body = await request.json().catch(() => null);
  const { toPhone, amount } = body || {};

  if (!toPhone || !amount || amount < 100) {
    return errorResponse('البيانات ناقصة (الحد الأدنى 100 ريال)', 400, headers);
  }

  const user = request.user;
  const fs = new FirestoreClient(env);

  const allowed = await checkRateLimit(env, `transfer:${user.uid}`, 5, 60);
  if (!allowed) return errorResponse('محاولات كثيرة', 429, headers);

  const recipients = await fs.query('users', [{ field: 'phone', op: '==', value: toPhone }], 1);
  if (recipients.length === 0) return errorResponse('المستلم غير موجود', 404, headers);

  const recipient = recipients[0];
  if (recipient.uid === user.uid) return errorResponse('لا يمكن التحويل لنفسك', 400, headers);

  const sender = await fs.getDoc('users', user.uid);
  if (!sender) return errorResponse('Sender not found', 404, headers);

  if ((sender.balance || 0) < amount) {
    return errorResponse(`الرصيد غير كافٍ. رصيدك: ${sender.balance}`, 400, headers);
  }

  try {
    const senderBalance = sender.balance;
    const recipientBalance = recipient.balance || 0;

    await fs.updateDoc('users', user.uid, {
      balance: senderBalance - amount,
      updatedAt: new Date()
    });

    await fs.updateDoc('users', recipient.uid, {
      balance: recipientBalance + amount,
      updatedAt: new Date()
    });

    const txId = 'TX' + Date.now() + Math.random().toString(36).substring(2, 6).toUpperCase();

    await fs.setDoc('transactions', txId + '_out', {
      uid: user.uid,
      userPhone: sender.phone,
      type: 'transfer',
      typeLabel: 'تحويل رصيد',
      amount: -amount,
      targetPhone: toPhone,
      targetUid: recipient.uid,
      description: `إلى: ${recipient.name}`,
      status: 'success',
      createdAt: new Date()
    });

    await fs.setDoc('transactions', txId + '_in', {
      uid: recipient.uid,
      userPhone: recipient.phone,
      type: 'transfer',
      typeLabel: 'استلام رصيد',
      amount: amount,
      sourcePhone: sender.phone,
      description: `من: ${sender.name}`,
      status: 'success',
      createdAt: new Date()
    });

    // إشعار للمستلم
    await fs.setDoc('notifications', 'N' + Date.now(), {
      userId: recipient.uid,
      icon: 'fa-arrow-down',
      color: 'linear-gradient(145deg, #25e38c, #18bf75)',
      title: '💰 استلمت رصيداً',
      message: `استلمت ${amount} ريال من ${sender.name}`,
      type: 'transfer_in',
      read: false,
      createdAt: new Date()
    });

    return successResponse({
      message: 'تم التحويل بنجاح',
      txId,
      newBalance: senderBalance - amount
    }, headers);

  } catch (error) {
    console.error('Transfer failed:', error);
    return errorResponse('فشل التحويل', 500, headers);
  }
}
