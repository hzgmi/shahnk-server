// ============================================================
// emailjs.js — إرسال OTP عبر EmailJS
// ============================================================

export async function sendOTPEmail(env, { toEmail, name, code }) {
  const payload = {
    service_id: 'service_sydr9nc',
    template_id: 'template_ern5c1n',
    user_id: 'UE9ZNevrRCpFUMFXj',
    accessToken: env.EMAILJS_PRIVATE_KEY,
    template_params: {
      to_email: toEmail,
      name: name,
      email: toEmail,
      username: toEmail,
      code: code
    }
  };

  const response = await fetch('https://api.emailjs.com/api/v1.0/email/send', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload)
  });

  if (!response.ok) {
    const error = await response.text();
    throw new Error(`EmailJS failed: ${response.status} — ${error}`);
  }

  return { success: true };
}

export function generateOTP() {
  const array = new Uint32Array(1);
  crypto.getRandomValues(array);
  const code = (array[0] % 900000) + 100000;
  return String(code);
}

export async function hashOTP(code, salt) {
  const encoder = new TextEncoder();
  const data = encoder.encode(`${code}:${salt}`);
  const hashBuffer = await crypto.subtle.digest('SHA-256', data);
  const hashArray = Array.from(new Uint8Array(hashBuffer));
  return hashArray.map(b => b.toString(16).padStart(2, '0')).join('');
}

export function generateSalt() {
  const array = new Uint8Array(16);
  crypto.getRandomValues(array);
  return Array.from(array).map(b => b.toString(16).padStart(2, '0')).join('');
      }
