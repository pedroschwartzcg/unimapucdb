import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.45.4';

const BUCKET = 'place-images';
const MAX_CLEANUP_AGE_MS = 30 * 60 * 1000;
const ALLOWED_ORIGINS = new Set((Deno.env.get('UNIMAP_ALLOWED_ORIGINS') ||
  'https://unimapucdb.netlify.app,http://localhost:3000,http://127.0.0.1:3000')
  .split(',').map(value => value.trim()).filter(Boolean));
const corsHeaders = {
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
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

  let path: unknown;
  try { path = (await request.json()).path; }
  catch { return jsonResponse({error: 'Invalid JSON body'}, 400, origin); }
  if (typeof path !== 'string' || !imagePathPattern.test(path)) {
    return jsonResponse({error: 'Invalid image path'}, 400, origin);
  }

  const supabaseUrl = Deno.env.get('SUPABASE_URL');
  const serviceRoleKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
  if (!supabaseUrl || !serviceRoleKey) {
    return jsonResponse({error: 'Cleanup service is not configured'}, 500, origin);
  }

  const admin = createClient(supabaseUrl, serviceRoleKey, {auth: {persistSession: false, autoRefreshToken: false}});
  const {data: reference, error: referenceError} = await admin
    .from('place_submission_details').select('place_id').eq('image_path', path).limit(1);
  if (referenceError) return jsonResponse({error: 'Could not check photo references'}, 500, origin);
  if (reference?.length) return jsonResponse({error: 'Photo is linked to a place'}, 409, origin);

  // Cleanup is restricted to fresh uploads, preventing this endpoint from becoming a general bucket cleaner.
  const {data: objects, error: objectError} = await admin.storage.from(BUCKET).list('', {search: path, limit: 2});
  if (objectError) return jsonResponse({error: 'Could not verify uploaded photo'}, 500, origin);
  const object = (objects || []).find(item => item.name === path);
  if (!object) return jsonResponse({deleted: true}, 200, origin);
  const createdAt = Date.parse(object.created_at);
  if (!Number.isFinite(createdAt) || Date.now() - createdAt > MAX_CLEANUP_AGE_MS) {
    return jsonResponse({error: 'Photo is outside the cleanup window'}, 410, origin);
  }

  // Use the Storage API so the object is removed from storage and its metadata together.
  const {error: removeError} = await admin.storage.from(BUCKET).remove([path]);
  if (removeError) return jsonResponse({error: 'Could not remove unlinked photo'}, 500, origin);
  return jsonResponse({deleted: true}, 200, origin);
});
