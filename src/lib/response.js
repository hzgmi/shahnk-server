// ============================================================
// response.js — استجابات JSON موحدة
// ============================================================

export function jsonResponse(data, headers = {}, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      'Content-Type': 'application/json; charset=utf-8',
      ...headers
    }
  });
}

export function errorResponse(message, status = 400, headers = {}) {
  return jsonResponse({ success: false, error: message }, headers, status);
}

export function successResponse(data = {}, headers = {}) {
  return jsonResponse({ success: true, ...data }, headers, 200);
}

// ============================================================
// Rate Limiting
// ============================================================
export async function checkRateLimit(env, key, limit, windowSeconds) {
  if (!env.RATE_LIMIT) return true;

  const now = Math.floor(Date.now() / 1000);
  const windowKey = `${key}:${Math.floor(now / windowSeconds)}`;

  const current = await env.RATE_LIMIT.get(windowKey);
  const count = current ? parseInt(current, 10) : 0;

  if (count >= limit) return false;

  await env.RATE_LIMIT.put(windowKey, String(count + 1), {
    expirationTtl: windowSeconds
  });

  return true;
  }
