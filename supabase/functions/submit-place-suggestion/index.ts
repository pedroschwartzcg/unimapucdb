import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.45.4';
import '../../../lib.js';

const BUCKET = 'place-images';
const MAX_IMAGE_SIZE = 5 * 1024 * 1024;
const MIME_EXTENSION: Record<string, string> = {
  'image/jpeg': 'jpg', 'image/png': 'png', 'image/webp': 'webp'
};
const allowedOrigins = new Set((Deno.env.get('UNIMAP_ALLOWED_ORIGINS') ||
  'https://unimapucdb.netlify.app,http://localhost:3000,http://127.0.0.1:3000')
  .split(',').map(value => value.trim()).filter(Boolean));
const corsHeaders = {
  'Access-Control-Allow-Headers': 'apikey, authorization, content-type, x-client-info',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Vary': 'Origin'
};
const UM = (globalThis as unknown as {UM: any}).UM;

function jsonResponse(body: unknown, status: number, origin: string) {
  return new Response(JSON.stringify(body), {
    status,
    headers: {...corsHeaders, 'Access-Control-Allow-Origin': origin, 'Content-Type': 'application/json'}
  });
}

async function sha256(value: string) {
  const data = new TextEncoder().encode(value);
  const hash = new Uint8Array(await crypto.subtle.digest('SHA-256', data));
  return [...hash].map(byte => byte.toString(16).padStart(2, '0')).join('');
}

Deno.serve(async request => {
  const origin = request.headers.get('origin') || '';
  if (!allowedOrigins.has(origin)) return new Response('Origin not allowed', {status: 403});
  if (request.method === 'OPTIONS') {
    return new Response('ok', {headers: {...corsHeaders, 'Access-Control-Allow-Origin': origin}});
  }
  if (request.method !== 'POST') return jsonResponse({error: 'Method not allowed'}, 405, origin);
  const contentLength = Number(request.headers.get('content-length') || 0);
  if (contentLength > MAX_IMAGE_SIZE + 128 * 1024) return jsonResponse({error: 'Request is too large'}, 413, origin);

  const supabaseUrl = Deno.env.get('SUPABASE_URL');
  const serviceRoleKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
  const rateLimitSalt = Deno.env.get('RATE_LIMIT_SALT');
  if (!supabaseUrl || !serviceRoleKey || !rateLimitSalt) {
    return jsonResponse({error: 'Submission service is not configured'}, 500, origin);
  }
  const ip = request.headers.get('cf-connecting-ip');
  if (!ip) return jsonResponse({error: 'Could not determine request source'}, 503, origin);

  const admin = createClient(supabaseUrl, serviceRoleKey, {auth: {persistSession: false, autoRefreshToken: false}});
  const ipHash = await sha256(`${rateLimitSalt}:${ip}`);
  const hourStart = new Date(Math.floor(Date.now() / 3600000) * 3600000).toISOString();
  const {data: withinLimit, error: limitError} = await admin.rpc('consume_place_submission_limit', {
    p_ip_hash: ipHash, p_window_start: hourStart, p_limit: 20
  });
  if (limitError) return jsonResponse({error: 'Could not check the submission limit'}, 500, origin);
  if (!withinLimit) return jsonResponse({error: 'Limite de 20 sugestões por hora atingido para esta rede.'}, 429, origin);

  let form: FormData;
  try { form = await request.formData(); }
  catch { return jsonResponse({error: 'Invalid form data'}, 400, origin); }
  const rawName = form.get('name');
  const rawDescription = form.get('description');
  const rawLat = form.get('lat');
  const rawLng = form.get('lng');
  if (typeof rawName !== 'string' || typeof rawLat !== 'string' || typeof rawLng !== 'string') {
    return jsonResponse({error: 'Nome ou coordenadas inválidas.'}, 400, origin);
  }
  if (rawDescription !== null && typeof rawDescription !== 'string') {
    return jsonResponse({error: 'Descrição inválida.'}, 400, origin);
  }
  const name = rawName.trim();
  const description = typeof rawDescription === 'string' ? rawDescription.trim() : '';
  const lat = Number(rawLat);
  const lng = Number(rawLng);
  if (!name || name.length > 80 || description.length > 500 || !rawLat.trim() || !rawLng.trim() || !UM.validCoords(lat, lng)) {
    return jsonResponse({error: 'Nome, descrição ou coordenadas inválidas.'}, 400, origin);
  }

  let file: File | null = null;
  const suppliedFile = form.get('photo');
  if (suppliedFile instanceof File) {
    if (suppliedFile.size === 0) return jsonResponse({error: 'A foto selecionada está vazia.'}, 400, origin);
    file = suppliedFile;
  }
  if (file && (file.size > MAX_IMAGE_SIZE || !MIME_EXTENSION[file.type])) {
    return jsonResponse({error: 'A foto deve ser JPG, PNG ou WebP e ter no máximo 5 MB.'}, 400, origin);
  }
  let bytes: Uint8Array | null = null;
  if (file) {
    bytes = new Uint8Array(await file.arrayBuffer());
    if (UM.sniffImageMime(bytes) !== file.type) {
      return jsonResponse({error: 'O conteúdo da foto não corresponde ao formato declarado.'}, 400, origin);
    }
  }

  const imagePath = file ? `${crypto.randomUUID()}.${MIME_EXTENSION[file.type]}` : null;
  const generatedPlaceId = crypto.randomUUID();
  const result = await UM.runPlaceSubmission(
    async () => {
      if (!file || !bytes || !imagePath) return {path: null};
      try {
        const {error} = await admin.storage.from(BUCKET).upload(imagePath, file, {
          contentType: file.type, cacheControl: '3600', upsert: false
        });
        return error ? {error, path: imagePath} : {path: imagePath};
      } catch (error) {
        return {error, path: imagePath};
      }
    },
    async () => {
      try {
        const {data, error} = await admin.from('places').insert({
          id: generatedPlaceId, name, cat: 'Sugestão', lat, lng, autor: 'aluno', approved: false
        }).select('id').single();
        return {data: data || {id: generatedPlaceId}, error};
      } catch (error) {
        return {data: {id: generatedPlaceId}, error};
      }
    },
    async (placeId: string, uploadedPath: string | null) => {
      const {error} = await admin.from('place_submission_details').insert({
        place_id: placeId, description: description || null, image_path: uploadedPath, rejected: false
      });
      return {error};
    },
    async (placeId: string) => {
      const {error} = await admin.from('places').delete().eq('id', placeId);
      return {error};
    },
    async (uploadedPath: string) => {
      const {data: reference, error: referenceError} = await admin.from('place_submission_details')
        .select('place_id').eq('image_path', uploadedPath).limit(1);
      if (referenceError) return {error: referenceError};
      if (reference?.length) return {error: new Error('Image is still linked to a submission')};
      const {error} = await admin.storage.from(BUCKET).remove([uploadedPath]);
      return {error};
    }
  );

  if (!result.ok) {
    console.error('Could not save place suggestion:', result.error, result.rollbackError, result.cleanupError);
    const cleanupPending = Boolean(imagePath && (result.rollbackError || result.cleanupError));
    return jsonResponse({
      error: 'Não foi possível salvar a sugestão.',
      cleanupPending,
      imagePath: cleanupPending ? imagePath : undefined
    }, 500, origin);
  }
  return jsonResponse({place_id: result.placeId, approved: false}, 201, origin);
});
