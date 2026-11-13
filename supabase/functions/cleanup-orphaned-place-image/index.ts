import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.45.4';
import {
  cleanupUnlinkedImage, readRequestBodyLimited, verifyCleanupToken
} from '../_shared/submission.mjs';

const BUCKET = 'place-images';
const MAX_CLEANUP_REQUEST_BYTES = 4096;
const ALLOWED_ORIGINS = new Set((Deno.env.get('UNIMAP_ALLOWED_ORIGINS') ||
  'https://unimapucdb.netlify.app,http://localhost:3000,http://127.0.0.1:3000')
  .split(',').map(value => value.trim()).filter(Boolean));
const corsHeaders = {
  'Access-Control-Allow-Headers': 'apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Vary': 'Origin'
};
const imagePathPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\.(jpg|png|webp)$/;

function jsonResponse(body: unknown, status: number, origin: string) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, 'Access-Control-Allow-Origin': origin, 'Content-Type': 'application/json' }
  });
}

Deno.serve(async request => {
  const origin = request.headers.get('origin') || '';
  if (!ALLOWED_ORIGINS.has(origin)) return new Response('Origin not allowed', {status: 403});
  if (request.method === 'OPTIONS') {
    return new Response('ok', {headers: {...corsHeaders, 'Access-Control-Allow-Origin': origin}});
  }
  if (request.method !== 'POST') return jsonResponse({error: 'Method not allowed'}, 405, origin);

  const boundedBody = await readRequestBodyLimited(request, MAX_CLEANUP_REQUEST_BYTES);
  if (!boundedBody.ok) {
    const status = boundedBody.reason === 'too_large' ? 413 : 400;
    return jsonResponse({error: 'Invalid cleanup request'}, status, origin);
  }
  let body: {path?: unknown; cleanupToken?: unknown};
  try { body = JSON.parse(new TextDecoder().decode(boundedBody.bytes)); }
  catch { return jsonResponse({error: 'Invalid JSON body'}, 400, origin); }
  const path = body.path;
  if (typeof path !== 'string' || !imagePathPattern.test(path)) {
    return jsonResponse({error: 'Invalid image path'}, 400, origin);
  }

  // CORS only restricts browser access. This signed capability is the authorization.
  const tokenSecret = Deno.env.get('CLEANUP_TOKEN_SECRET');
  if (!tokenSecret) return jsonResponse({error: 'Cleanup authorization is not configured'}, 500, origin);
  const authorized = await verifyCleanupToken(body.cleanupToken, path, tokenSecret);
  if (!authorized) return jsonResponse({error: 'Cleanup authorization required'}, 401, origin);

  const supabaseUrl = Deno.env.get('SUPABASE_URL');
  const serviceRoleKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
  if (!supabaseUrl || !serviceRoleKey) {
    return jsonResponse({error: 'Cleanup service is not configured'}, 500, origin);
  }

  const admin = createClient(supabaseUrl, serviceRoleKey, {auth: {persistSession: false, autoRefreshToken: false}});
  const outcome = await cleanupUnlinkedImage(path, {
    findReference: async (imagePath: string) => {
      const {data, error} = await admin.from('place_submission_details')
        .select('place_id').eq('image_path', imagePath).limit(1);
      return error ? {error} : {linked: Boolean(data?.length)};
    },
    findObject: async (imagePath: string) => {
      const {data, error} = await admin.storage.from(BUCKET).list('', {search: imagePath, limit: 2});
      if (error) return {error};
      const object = (data || []).find(item => item.name === imagePath);
      return object ? {createdAt: object.created_at} : null;
    },
    remove: async (imagePath: string) => {
      const {error} = await admin.storage.from(BUCKET).remove([imagePath]);
      return {error};
    }
  });
  if (outcome.ok) return jsonResponse({deleted: true, alreadyMissing: outcome.reason === 'already_missing'}, 200, origin);
  if (outcome.reason === 'image_linked') return jsonResponse({error: 'Photo is linked to a place'}, 409, origin);
  if (outcome.reason === 'outside_cleanup_window') return jsonResponse({error: 'Photo is outside the cleanup window'}, 410, origin);
  const message = outcome.reason === 'reference_check_failed' ? 'Could not check photo references'
    : outcome.reason === 'object_check_failed' ? 'Could not verify uploaded photo'
    : 'Could not remove unlinked photo';
  console.error('Orphan image cleanup failed:', outcome.reason, outcome.error);
  return jsonResponse({error: message}, 500, origin);
});
