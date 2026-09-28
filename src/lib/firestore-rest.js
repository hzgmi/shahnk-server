// ============================================================
// firestore-rest.js — عميل Firestore REST
// ============================================================

import { getGoogleAccessToken, getServiceAccount } from './firebase-admin-auth.js';

const FIRESTORE_BASE = 'https://firestore.googleapis.com/v1';

// ============================================================
// تحويل بين JS و Firestore format
// ============================================================
export function toFirestoreValue(value) {
  if (value === null || value === undefined) return { nullValue: null };
  if (typeof value === 'string') return { stringValue: value };
  if (typeof value === 'boolean') return { booleanValue: value };
  if (typeof value === 'number') {
    if (Number.isInteger(value)) return { integerValue: String(value) };
    return { doubleValue: value };
  }
  if (Array.isArray(value)) {
    return { arrayValue: { values: value.map(toFirestoreValue) } };
  }
  if (typeof value === 'object') {
    if (value instanceof Date) {
      return { timestampValue: value.toISOString() };
    }
    const fields = {};
    for (const [k, v] of Object.entries(value)) {
      if (v !== undefined) fields[k] = toFirestoreValue(v);
    }
    return { mapValue: { fields } };
  }
  return { nullValue: null };
}

export function fromFirestoreValue(fv) {
  if (!fv) return null;
  if ('nullValue' in fv) return null;
  if ('stringValue' in fv) return fv.stringValue;
  if ('booleanValue' in fv) return fv.booleanValue;
  if ('integerValue' in fv) return parseInt(fv.integerValue, 10);
  if ('doubleValue' in fv) return parseFloat(fv.doubleValue);
  if ('timestampValue' in fv) return new Date(fv.timestampValue);
  if ('arrayValue' in fv) {
    return (fv.arrayValue.values || []).map(fromFirestoreValue);
  }
  if ('mapValue' in fv) {
    const obj = {};
    for (const [k, v] of Object.entries(fv.mapValue.fields || {})) {
      obj[k] = fromFirestoreValue(v);
    }
    return obj;
  }
  return null;
}

export function docToObject(doc) {
  if (!doc || !doc.fields) return null;
  const obj = {};
  for (const [k, v] of Object.entries(doc.fields)) {
    obj[k] = fromFirestoreValue(v);
  }
  if (doc.name) {
    const parts = doc.name.split('/');
    obj._id = parts[parts.length - 1];
  }
  return obj;
}

export function objectToDoc(obj) {
  const fields = {};
  for (const [k, v] of Object.entries(obj)) {
    if (v !== undefined) fields[k] = toFirestoreValue(v);
  }
  return { fields };
}

// ============================================================
// Firestore Client
// ============================================================
export class FirestoreClient {
  constructor(env) {
    this.env = env;
    this.projectId = env.FIREBASE_PROJECT_ID;
    this.serviceAccount = getServiceAccount(env);
  }

  async getAccessToken() {
    return getGoogleAccessToken(this.serviceAccount);
  }

  async _fetch(path, options = {}) {
    const token = await this.getAccessToken();
    const url = `${FIRESTORE_BASE}/projects/${this.projectId}/databases/(default)/documents${path}`;

    const response = await fetch(url, {
      ...options,
      headers: {
        'Authorization': `Bearer ${token}`,
        'Content-Type': 'application/json',
        ...(options.headers || {})
      }
    });

    return response;
  }

  // READ
  async getDoc(collection, docId) {
    const res = await this._fetch(`/${collection}/${docId}`);
    if (res.status === 404) return null;
    if (!res.ok) {
      const err = await res.text();
      throw new Error(`Firestore getDoc failed: ${err}`);
    }
    const data = await res.json();
    return docToObject(data);
  }

  // WRITE
  async setDoc(collection, docId, data) {
    const doc = objectToDoc(data);
    const res = await this._fetch(`/${collection}/${docId}`, {
      method: 'PATCH',
      body: JSON.stringify(doc)
    });

    if (!res.ok) {
      const err = await res.text();
      throw new Error(`Firestore setDoc failed: ${err}`);
    }

    return await res.json();
  }

  // UPDATE
  async updateDoc(collection, docId, updates) {
    const keys = Object.keys(updates);
    const updateMask = keys.map(k => `updateMask.fieldPaths=${encodeURIComponent(k)}`).join('&');

    const fields = {};
    for (const [k, v] of Object.entries(updates)) {
      fields[k] = toFirestoreValue(v);
    }

    const res = await this._fetch(`/${collection}/${docId}?${updateMask}`, {
      method: 'PATCH',
      body: JSON.stringify({ fields })
    });

    if (!res.ok) {
      const err = await res.text();
      throw new Error(`Firestore updateDoc failed: ${err}`);
    }

    return await res.json();
  }

  // DELETE
  async deleteDoc(collection, docId) {
    const res = await this._fetch(`/${collection}/${docId}`, {
      method: 'DELETE'
    });
    if (!res.ok && res.status !== 404) {
      const err = await res.text();
      throw new Error(`Firestore deleteDoc failed: ${err}`);
    }
    return true;
  }

  // QUERY
  async query(collection, filters = [], limit = 50) {
    const structuredQuery = {
      from: [{ collectionId: collection }],
      where: filters.length > 0 ? buildWhereClause(filters) : undefined,
      limit
    };

    const res = await this._fetch(':runQuery', {
      method: 'POST',
      body: JSON.stringify({ structuredQuery })
    });

    if (!res.ok) {
      const err = await res.text();
      throw new Error(`Firestore query failed: ${err}`);
    }

    const results = await res.json();
    return results
      .filter(r => r.document)
      .map(r => docToObject(r.document));
  }
}

function buildWhereClause(filters) {
  if (filters.length === 1) {
    return fieldFilter(filters[0]);
  }
  return {
    compositeFilter: {
      op: 'AND',
      filters: filters.map(fieldFilter)
    }
  };
}

function fieldFilter({ field, op, value }) {
  const opMap = {
    '==': 'EQUAL',
    '!=': 'NOT_EQUAL',
    '<': 'LESS_THAN',
    '<=': 'LESS_THAN_OR_EQUAL',
    '>': 'GREATER_THAN',
    '>=': 'GREATER_THAN_OR_EQUAL',
    'array-contains': 'ARRAY_CONTAINS',
    'in': 'IN'
  };
  return {
    fieldFilter: {
      field: { fieldPath: field },
      op: opMap[op] || 'EQUAL',
      value: toFirestoreValue(value)
    }
  };
}
