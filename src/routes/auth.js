// ============================================================
// auth.js — تسجيل ودخول المستخدمين
// ============================================================

import { successResponse, errorResponse, checkRateLimit } from '../lib/response.js';
import { FirestoreClient } from '../lib/firestore-rest.js';
import { sendOTPEmail, generateOTP, hashOTP, generateSalt } from '../lib/emailjs.js';
import { getGoogleAccessToken, getServiceAccount } from '../lib/firebase-admin-auth.js';
import { SignJWT, importPKCS8 } from 'jose';

export async function handleAuth(request, env, headers) {
  const url = new URL(request.url);
  const path = url.pathname.replace('/api/auth', '');
  const method = request.method;

  if (path === '/register' && method === 'POST') {
    return await registerUser(request, env, headers);
  }
  if (path === '/verify-otp' && method === 'POST') {
    return await verifyOTP(request, env, headers);
  }
  if (path === '/resend-otp' && method === 'POST') {
    return await resendOTP(request, env, headers);
  }
  if (path === '/login-lookup' && method === 'POST') {
    return await loginLookup(request, env, headers);
  }

  return errorResponse('Unknown auth endpoint', 404, headers);
}

// ═══ REGISTER ═══
async function registerUser(request, env, headers) {
  const body = await request.json().catch(() => null);
  if (!body) return errorResponse('Invalid JSON', 400, headers);

  const { name, phone, email, password } = body;

  if (!name || name.trim().length < 2) return errorResponse('الاسم مطلوب', 400, headers);
  if (!phone || !/^\+967[0-9]{9}$/.test(phone)) return errorResponse('رقم هاتف غير صحيح', 400, headers);
  if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return errorResponse('بريد غير صحيح', 400, headers);
  if (!password || password.length < 6) return errorResponse('كلمة المرور 6 أحرف على الأقل', 400, headers);

  const ip = request.headers.get('CF-Connecting-IP') || 'unknown';
  const allowed = await checkRateLimit(env, `register:${ip}`, 3, 600);
  if (!allowed) return errorResponse('محاولات كثيرة، حاول لاحقاً', 429, headers);

  const fs = new FirestoreClient(env);

  const existingByPhone = await fs.query('users', [{ field: 'phone', op: '==', value: phone }], 1);
  if (existingByPhone.length > 0) return errorResponse('رقم الهاتف مسجل مسبقاً', 409, headers);

  const existingByEmail = await fs.query('users', [{ field: 'email', op: '==', value: email.toLowerCase() }], 1);
  if (existingByEmail.length > 0) return errorResponse('البريد مسجل مسبقاً', 409, headers);

  const code = generateOTP();
  const salt = generateSalt();
  const codeHash = await hashOTP(code, salt);
  const expiresAt = Date.now() + 10 * 60 * 1000;

  const emailKey = email.toLowerCase().replace(/[^a-z0-9]/g, '_');
  await fs.setDoc('pending_users', emailKey, {
    name: name.trim(),
    phone,
    email: email.toLowerCase(),
    password,
    salt,
    otpHash: codeHash,
    otpExpiresAt: expiresAt,
    otpAttempts: 0,
    createdAt: new Date(),
    status: 'pending_otp'
  });

  try {
    await sendOTPEmail(env, { toEmail: email, name, code });
  } catch (error) {
    console.error('Email send failed:', error);
    return errorResponse('فشل إرسال البريد، حاول لاحقاً', 500, headers);
  }

  return successResponse({
    message: 'تم إرسال كود التحقق إلى بريدك',
    email: email.toLowerCase(),
    expiresIn: 600
  }, headers);
}

// ═══ VERIFY OTP ═══
async function verifyOTP(request, env, headers) {
  const body = await request.json().catch(() => null);
  if (!body) return errorResponse('Invalid JSON', 400, headers);

  const { email, code } = body;
  if (!email || !code || code.length !== 6) return errorResponse('البيانات ناقصة', 400, headers);

  const ip = request.headers.get('CF-Connecting-IP') || 'unknown';
  const allowed = await checkRateLimit(env, `verify:${ip}`, 10, 600);
  if (!allowed) return errorResponse('محاولات كثيرة', 429, headers);

  const fs = new FirestoreClient(env);
  const emailKey = email.toLowerCase().replace(/[^a-z0-9]/g, '_');
  const pending = await fs.getDoc('pending_users', emailKey);

  if (!pending) return errorResponse('لم يتم العثور على طلب تسجيل', 404, headers);
  if (pending.status !== 'pending_otp') return errorResponse('تم التحقق مسبقاً', 400, headers);
  if (Date.now() > pending.otpExpiresAt) return errorResponse('انتهت صلاحية الكود', 400, headers);
  if (pending.otpAttempts >= 5) return errorResponse('تجاوزت الحد الأقصى', 429, headers);

  const codeHash = await hashOTP(code, pending.salt);
  if (codeHash !== pending.otpHash) {
    await fs.updateDoc('pending_users', emailKey, {
      otpAttempts: (pending.otpAttempts || 0) + 1
    });
    return errorResponse('كود غير صحيح', 401, headers);
  }

  try {
    const uid = await createFirebaseAuthUser(env, pending.email, pending.password, pending.name);
    if (!uid) return errorResponse('فشل إنشاء الحساب', 500, headers);

    const accountNumber = generateAccountNumber(uid);

    await fs.setDoc('users', uid, {
      uid,
      name: pending.name,
      phone: pending.phone,
      email: pending.email,
      accountNumber,
      balance: 0,
      displayCurrency: 'YER',
      isAdmin: false,
      isAgent: false,
      isAgentActive: false,
      emailVerified: true,
      profileCompleted: true,
      trustedDevices: [],
      twoFactorEnabled: false,
      createdAt: new Date(),
      updatedAt: new Date()
    });

    await fs.deleteDoc('pending_users', emailKey);

    const customToken = await createCustomToken(env, uid);

    return successResponse({
      message: 'تم التحقق بنجاح',
      uid,
      customToken,
      accountNumber
    }, headers);

  } catch (error) {
    console.error('User creation failed:', error);
    return errorResponse('فشل إنشاء الحساب: ' + error.message, 500, headers);
  }
}

// ═══ RESEND OTP ═══
async function resendOTP(request, env, headers) {
  const body = await request.json().catch(() => null);
  if (!body || !body.email) return errorResponse('البريد مطلوب', 400, headers);

  const ip = request.headers.get('CF-Connecting-IP') || 'unknown';
  const allowed = await checkRateLimit(env, `resend:${ip}`, 3, 600);
  if (!allowed) return errorResponse('محاولات كثيرة', 429, headers);

  const fs = new FirestoreClient(env);
  const emailKey = body.email.toLowerCase().replace(/[^a-z0-9]/g, '_');
  const pending = await fs.getDoc('pending_users', emailKey);

  if (!pending || pending.status !== 'pending_otp') {
    return errorResponse('لا يوجد طلب تسجيل معلق', 404, headers);
  }

  const code = generateOTP();
  const codeHash = await hashOTP(code, pending.salt);
  const expiresAt = Date.now() + 10 * 60 * 1000;

  await fs.updateDoc('pending_users', emailKey, {
    otpHash: codeHash,
    otpExpiresAt: expiresAt,
    otpAttempts: 0
  });

  await sendOTPEmail(env, {
    toEmail: pending.email,
    name: pending.name,
    code
  });

  return successResponse({ message: 'تم إعادة إرسال الكود' }, headers);
}

// ═══ LOGIN LOOKUP ═══
async function loginLookup(request, env, headers) {
  const body = await request.json().catch(() => null);
  if (!body || !body.phone) return errorResponse('رقم الهاتف مطلوب', 400, headers);

  const ip = request.headers.get('CF-Connecting-IP') || 'unknown';
  const allowed = await checkRateLimit(env, `lookup:${ip}`, 10, 60);
  if (!allowed) return errorResponse('محاولات كثيرة', 429, headers);

  const fs = new FirestoreClient(env);
  const users = await fs.query('users', [{ field: 'phone', op: '==', value: body.phone }], 1);

  if (users.length === 0) return errorResponse('رقم الهاتف غير مسجل', 404, headers);

  return successResponse({
    email: users[0].email,
    exists: true
  }, headers);
}

// ═══ HELPERS ═══
function generateAccountNumber(uid) {
  if (!uid) return null;

  const PREFIX = '77';
  let hash = 0;
  for (let i = 0; i < uid.length; i++) {
    const char = uid.charCodeAt(i);
    hash = ((hash << 5) - hash) + char;
    hash = hash & hash;
  }

  const positiveHash = Math.abs(hash);
  const digits = String(positiveHash).padStart(7, '0').slice(-7);

  return PREFIX + digits;
}

async function createFirebaseAuthUser(env, email, password, displayName) {
  const webApiKey = env.FIREBASE_WEB_API_KEY;
  if (!webApiKey) throw new Error('FIREBASE_WEB_API_KEY not set');

  const response = await fetch(
    `https://identitytoolkit.googleapis.com/v1/accounts:signUp?key=${webApiKey}`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        email,
        password,
        displayName,
        emailVerified: true,
        returnSecureToken: true
      })
    }
  );

  if (!response.ok) {
    const error = await response.json();
    throw new Error(error.error?.message || 'Auth creation failed');
  }

  const data = await response.json();
  return data.localId;
}

async function createCustomToken(env, uid) {
  const serviceAccount = getServiceAccount(env);
  const privateKey = await importPKCS8(serviceAccount.private_key, 'RS256');
  const now = Math.floor(Date.now() / 1000);

  const token = await new SignJWT({
    uid,
    iat: now,
    exp: now + 3600,
    iss: serviceAccount.client_email,
    sub: serviceAccount.client_email,
    aud: 'https://identitytoolkit.googleapis.com/google.identity.identitytoolkit.v1.IdentityToolkit'
  })
    .setProtectedHeader({ alg: 'RS256', typ: 'JWT' })
    .sign(privateKey);

  return token;
}
