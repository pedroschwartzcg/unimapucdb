export const MAX_IMAGE_SIZE = 5 * 1024 * 1024;
export const MAX_REQUEST_BODY_SIZE = MAX_IMAGE_SIZE + 64 * 1024;
export const MAX_CLEANUP_AGE_MS = 30 * 60 * 1000;

export function validCoords(lat, lng) {
  return Number.isFinite(lat) && Number.isFinite(lng) &&
    lat >= -90 && lat <= 90 && lng >= -180 && lng <= 180;
}

export function sniffImageMime(bytes) {
  const data = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes || []);
  if (data.length >= 3 && data[0] === 0xff && data[1] === 0xd8 && data[2] === 0xff) return 'image/jpeg';
  const png = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];
  if (data.length >= png.length && png.every((byte, index) => data[index] === byte)) return 'image/png';
  if (data.length >= 12 && String.fromCharCode(...data.subarray(0, 4)) === 'RIFF' &&
      String.fromCharCode(...data.subarray(8, 12)) === 'WEBP') return 'image/webp';
  return null;
}

export function validateSuggestionFields(rawName, rawDescription, rawLat, rawLng) {
  if (typeof rawName !== 'string' || typeof rawLat !== 'string' || typeof rawLng !== 'string' ||
      (rawDescription !== null && rawDescription !== undefined && typeof rawDescription !== 'string')) {
    return {ok: false, reason: 'invalid_fields'};
  }
  const name = rawName.trim();
  const description = typeof rawDescription === 'string' ? rawDescription.trim() : '';
  if (!name) return {ok: false, reason: 'missing_name'};
  if (name.length > 80 || description.length > 500) return {ok: false, reason: 'text_too_long'};
  if (!rawLat.trim() || !rawLng.trim() || !validCoords(Number(rawLat), Number(rawLng))) {
    return {ok: false, reason: 'invalid_coordinates'};
  }
  return {ok: true, name, description, lat: Number(rawLat), lng: Number(rawLng)};
}

export function validateImageFile(file, bytes) {
  if (!file || !Number.isSafeInteger(file.size) || file.size <= 0) {
    return {ok: false, reason: 'empty_image'};
  }
  if (file.size > MAX_IMAGE_SIZE) return {ok: false, reason: 'image_too_large'};
  if (!['image/jpeg', 'image/png', 'image/webp'].includes(file.type)) {
    return {ok: false, reason: 'unsupported_image_type'};
  }
  if (!(bytes instanceof Uint8Array) || bytes.byteLength !== file.size || sniffImageMime(bytes) !== file.type) {
    return {ok: false, reason: 'image_signature_mismatch'};
  }
  return {ok: true, mimeType: file.type};
}

export async function readRequestBodyLimited(request, maximumBytes = MAX_REQUEST_BODY_SIZE) {
  const declaredLength = request.headers.get('content-length');
  if (declaredLength !== null) {
    if (!/^\d+$/.test(declaredLength)) return {ok: false, reason: 'invalid_length'};
    if (Number(declaredLength) > maximumBytes) return {ok: false, reason: 'too_large'};
  }

  const reader = request.body?.getReader();
  if (!reader) return {ok: true, bytes: new Uint8Array()};
  const chunks = [];
  let total = 0;
  try {
    while (true) {
      const {done, value} = await reader.read();
      if (done) break;
      total += value.byteLength;
      if (total > maximumBytes) {
        await reader.cancel('Request body exceeds the configured limit').catch(() => {});
        return {ok: false, reason: 'too_large'};
      }
      chunks.push(value);
    }
  } catch {
    return {ok: false, reason: 'read_error'};
  } finally {
    reader.releaseLock();
  }

  const bytes = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return {ok: true, bytes};
}

function base64Url(bytes) {
  let binary = '';
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/g, '');
}

function decodeBase64Url(value) {
  if (!/^[A-Za-z0-9_-]+$/.test(value)) throw new Error('Invalid base64url');
  const normalized = value.replace(/-/g, '+').replace(/_/g, '/');
  const binary = atob(normalized + '='.repeat((4 - normalized.length % 4) % 4));
  return Uint8Array.from(binary, char => char.charCodeAt(0));
}

async function importHmacKey(secret) {
  if (typeof secret !== 'string' || new TextEncoder().encode(secret).length < 32) {
    throw new Error('CLEANUP_TOKEN_SECRET must contain at least 32 bytes');
  }
  return crypto.subtle.importKey(
    'raw', new TextEncoder().encode(secret), {name: 'HMAC', hash: 'SHA-256'}, false, ['sign', 'verify']
  );
}

export async function createCleanupToken(path, secret, now = Date.now()) {
  const payload = new TextEncoder().encode(JSON.stringify({
    version: 1, path, issuedAt: now, expiresAt: now + MAX_CLEANUP_AGE_MS
  }));
  const key = await importHmacKey(secret);
  const signature = new Uint8Array(await crypto.subtle.sign('HMAC', key, payload));
  return base64Url(payload) + '.' + base64Url(signature);
}

export async function verifyCleanupToken(token, expectedPath, secret, now = Date.now()) {
  if (typeof token !== 'string' || token.length > 2048) return false;
  const parts = token.split('.');
  if (parts.length !== 2) return false;
  try {
    const payloadBytes = decodeBase64Url(parts[0]);
    const signature = decodeBase64Url(parts[1]);
    const payload = JSON.parse(new TextDecoder().decode(payloadBytes));
    if (payload.version !== 1 || payload.path !== expectedPath ||
        !Number.isSafeInteger(payload.issuedAt) || !Number.isSafeInteger(payload.expiresAt) ||
        payload.expiresAt - payload.issuedAt !== MAX_CLEANUP_AGE_MS ||
        payload.issuedAt > now || payload.expiresAt < now) return false;
    const key = await importHmacKey(secret);
    return crypto.subtle.verify('HMAC', key, signature, payloadBytes);
  } catch {
    return false;
  }
}

export async function cleanupUnlinkedImage(path, operations, now = Date.now()) {
  let reference;
  try { reference = await operations.findReference(path); }
  catch (error) { return {ok: false, reason: 'reference_check_failed', error}; }
  if (reference?.error) return {ok: false, reason: 'reference_check_failed', error: reference.error};
  if (reference?.linked) return {ok: false, reason: 'image_linked'};

  let object;
  try { object = await operations.findObject(path); }
  catch (error) { return {ok: false, reason: 'object_check_failed', error}; }
  if (object?.error) return {ok: false, reason: 'object_check_failed', error: object.error};
  if (!object) return {ok: true, reason: 'already_missing'};

  const createdAt = typeof object.createdAt === 'number' ? object.createdAt : Date.parse(object.createdAt);
  if (!Number.isFinite(createdAt) || now - createdAt > MAX_CLEANUP_AGE_MS || createdAt > now + 60_000) {
    return {ok: false, reason: 'outside_cleanup_window'};
  }

  try {
    const removal = await operations.remove(path);
    if (removal?.error) return {ok: false, reason: 'remove_failed', error: removal.error};
    return {ok: true, reason: 'removed'};
  } catch (error) {
    return {ok: false, reason: 'remove_failed', error};
  }
}

export async function runPlaceSubmission(uploadImage, insertPlace, insertDetails, rollbackPlace, removeImage) {
  let imagePath = null;
  let placeId = null;
  try {
    const uploaded = await uploadImage();
    imagePath = uploaded && uploaded.path ? uploaded.path : null;
    if (uploaded && uploaded.error) throw uploaded.error;
    const inserted = await insertPlace(imagePath);
    placeId = inserted && inserted.data ? inserted.data.id : (inserted && inserted.id ? inserted.id : null);
    if (inserted && inserted.error) throw inserted.error;
    if (!placeId) throw new Error('Place insert returned no id');
    const details = await insertDetails(placeId, imagePath);
    if (details && details.error) throw details.error;
    return {ok: true, placeId, imagePath, error: null, rollbackError: null, cleanupError: null};
  } catch (error) {
    let rollbackError = null;
    if (placeId) {
      try {
        const rollback = await rollbackPlace(placeId);
        rollbackError = rollback && rollback.error ? rollback.error : null;
      } catch (failure) { rollbackError = failure; }
    }
    let cleanupError = null;
    if (imagePath && !rollbackError) {
      try {
        const removed = await removeImage(imagePath);
        cleanupError = removed && removed.error ? removed.error : null;
      } catch (failure) { cleanupError = failure; }
    } else if (imagePath && rollbackError) {
      cleanupError = new Error('Image cleanup skipped because the new place could not be rolled back');
    }
    return {ok: false, placeId, imagePath, error, rollbackError, cleanupError};
  }
}
