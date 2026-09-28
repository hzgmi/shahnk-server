// ============================================================
// services.js — خدمات الشحن (ألعاب، فواتير، إلخ)
// ============================================================

import { successResponse, errorResponse, checkRateLimit } from '../lib/response.js';
import { FirestoreClient } from '../lib/firestore-rest.js';

export async function handleServices(request, env, headers) {
  const url = new URL(request.url);
  const path = url.pathname.replace('/api/services', '');
  const method = request.method;

  if (path === '/game' && method === 'POST') return await orderGame(request, env, headers);
  if (path === '/bill' && method === 'POST') return await payBill(request, env, headers);
  if (path === '/recharge' && method === 'POST') return await rechargePhone(request, env, headers);
  if (path === '/subscription' && method === 'POST') return await orderSubscription(request, env, headers);
  if (path === '/giftcard' && method === 'POST') return await orderGiftCard(request, env, headers);

  return errorResponse('Unknown services endpoint', 404, headers);
}

async function orderGame(request, env, headers) {
  const body = await request.json().catch(() => null);
  const { gameId, gameName, packageLabel, priceYER, playerId, serverId, gateway } = body || {};

  if (!gameId || !packageLabel || !priceYER || !playerId) {
    return errorResponse('البيانات ناقصة', 400, headers);
  }

  const allowed = await checkRateLimit(env, `game:${request.user.uid}`, 5, 60);
  if (!allowed) return errorResponse('محاولات كثيرة', 429, headers);

  const fs = new FirestoreClient(env);
  const userDoc = await fs.getDoc('users', request.user.uid);

  if ((userDoc.balance || 0) < priceYER) {
    return errorResponse(`الرصيد غير كافٍ. رصيدك: ${userDoc.balance}`, 400, headers);
  }

  await fs.updateDoc('users', request.user.uid, {
    balance: userDoc.balance - priceYER,
    updatedAt: new Date()
  });

  const orderId = 'GME' + Date.now();
  await fs.setDoc('game_orders', orderId, {
    id: orderId,
    uid: request.user.uid,
    userName: userDoc.name,
    userPhone: userDoc.phone,
    gameId,
    gameName,
    packageLabel,
    priceYER,
    playerId,
    serverId: serverId || '',
    gateway: gateway || 'south',
    status: 'pending',
    createdAt: new Date()
  });

  await fs.setDoc('transactions', orderId, {
    uid: request.user.uid,
    userPhone: userDoc.phone,
    type: 'game',
    typeLabel: 'شحن لعبة',
    amount: -priceYER,
    targetPhone: playerId,
    description: `${gameName} — ${packageLabel}`,
    status: 'pending',
    createdAt: new Date()
  });

  await fs.setDoc('notifications', 'N' + Date.now(), {
    forAdmin: true,
    icon: 'fa-gamepad',
    color: 'linear-gradient(145deg, #7d42ff, #00c8ff)',
    title: '🎮 طلب شحن لعبة',
    message: `${gameName} — ${packageLabel} — ${priceYER} ريال`,
    type: 'game_order',
    orderId,
    read: false,
    createdAt: new Date()
  });

  return successResponse({
    message: 'تم إرسال الطلب',
    orderId,
    newBalance: userDoc.balance - priceYER
  }, headers);
}

async function payBill(request, env, headers) {
  const body = await request.json().catch(() => null);
  const { billType, provider, account, amount } = body || {};

  if (!billType || !provider || !account || !amount) {
    return errorResponse('البيانات ناقصة', 400, headers);
  }

  const fs = new FirestoreClient(env);
  const userDoc = await fs.getDoc('users', request.user.uid);

  if ((userDoc.balance || 0) < amount) {
    return errorResponse(`الرصيد غير كافٍ. رصيدك: ${userDoc.balance}`, 400, headers);
  }

  await fs.updateDoc('users', request.user.uid, {
    balance: userDoc.balance - amount,
    updatedAt: new Date()
  });

  const orderId = 'BIL' + Date.now();
  await fs.setDoc('transactions', orderId, {
    uid: request.user.uid,
    userPhone: userDoc.phone,
    type: 'bill',
    typeLabel: `سداد ${billType}`,
    amount: -amount,
    targetPhone: account,
    description: `${provider} — ${account}`,
    status: 'success',
    createdAt: new Date()
  });

  return successResponse({
    message: 'تم السداد بنجاح',
    orderId,
    newBalance: userDoc.balance - amount
  }, headers);
}

async function rechargePhone(request, env, headers) {
  const body = await request.json().catch(() => null);
  const { provider, targetPhone, amount, description, gateway } = body || {};

  if (!provider || !targetPhone || !amount) {
    return errorResponse('البيانات ناقصة', 400, headers);
  }

  const fs = new FirestoreClient(env);
  const userDoc = await fs.getDoc('users', request.user.uid);

  if ((userDoc.balance || 0) < amount) {
    return errorResponse(`الرصيد غير كافٍ. رصيدك: ${userDoc.balance}`, 400, headers);
  }

  await fs.updateDoc('users', request.user.uid, {
    balance: userDoc.balance - amount,
    updatedAt: new Date()
  });

  const orderId = 'RCH' + Date.now();
  await fs.setDoc('transactions', orderId, {
    uid: request.user.uid,
    userPhone: userDoc.phone,
    type: 'recharge',
    typeLabel: 'شحن رصيد',
    amount: -amount,
    targetPhone,
    provider,
    description: description || 'شحن رصيد',
    status: 'success',
    createdAt: new Date()
  });

  return successResponse({
    message: 'تم الشحن بنجاح',
    orderId,
    newBalance: userDoc.balance - amount
  }, headers);
}

async function orderSubscription(request, env, headers) {
  const body = await request.json().catch(() => null);
  const { subId, subName, packageLabel, priceYER, email } = body || {};

  if (!subId || !packageLabel || !priceYER || !email) {
    return errorResponse('البيانات ناقصة', 400, headers);
  }

  const fs = new FirestoreClient(env);
  const userDoc = await fs.getDoc('users', request.user.uid);

  if ((userDoc.balance || 0) < priceYER) {
    return errorResponse('الرصيد غير كافٍ', 400, headers);
  }

  await fs.updateDoc('users', request.user.uid, {
    balance: userDoc.balance - priceYER
  });

  const orderId = 'SUB' + Date.now();
  await fs.setDoc('subscription_orders', orderId, {
    id: orderId,
    uid: request.user.uid,
    userName: userDoc.name,
    userPhone: userDoc.phone,
    subId,
    subName,
    packageLabel,
    priceYER,
    email,
    status: 'pending',
    createdAt: new Date()
  });

  await fs.setDoc('transactions', orderId, {
    uid: request.user.uid,
    userPhone: userDoc.phone,
    type: 'subscription',
    typeLabel: 'اشتراك',
    amount: -priceYER,
    provider: subName,
    description: packageLabel,
    status: 'pending',
    createdAt: new Date()
  });

  return successResponse({
    message: 'تم إرسال الطلب',
    orderId,
    newBalance: userDoc.balance - priceYER
  }, headers);
}

async function orderGiftCard(request, env, headers) {
  const body = await request.json().catch(() => null);
  const { cardId, cardName, packageLabel, priceYER } = body || {};

  if (!cardId || !packageLabel || !priceYER) {
    return errorResponse('البيانات ناقصة', 400, headers);
  }

  const fs = new FirestoreClient(env);
  const userDoc = await fs.getDoc('users', request.user.uid);

  if ((userDoc.balance || 0) < priceYER) {
    return errorResponse('الرصيد غير كافٍ', 400, headers);
  }

  await fs.updateDoc('users', request.user.uid, {
    balance: userDoc.balance - priceYER
  });

  const orderId = 'GFT' + Date.now();
  await fs.setDoc('giftcard_orders', orderId, {
    id: orderId,
    uid: request.user.uid,
    userName: userDoc.name,
    userPhone: userDoc.phone,
    cardId,
    cardName,
    packageLabel,
    priceYER,
    status: 'pending',
    createdAt: new Date()
  });

  await fs.setDoc('transactions', orderId, {
    uid: request.user.uid,
    userPhone: userDoc.phone,
    type: 'giftcard',
    typeLabel: 'بطاقة',
    amount: -priceYER,
    provider: cardName,
    description: packageLabel,
    status: 'pending',
    createdAt: new Date()
  });

  return successResponse({
    message: 'تم إرسال الطلب',
    orderId,
    newBalance: userDoc.balance - priceYER
  }, headers);
      }
