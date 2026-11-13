import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.45.4';
import {
  createCleanupToken, MAX_REQUEST_BODY_SIZE, readRequestBodyLimited,
  runPlaceSubmission, validateImageFile, validateSuggestionFields
} from '../_shared/submission.mjs';

const BUCKET = 'place-images';
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

  const boundedBody = await readRequestBodyLimited(request, MAX_REQUEST_BODY_SIZE);
  if (!boundedBody.ok) {
    const status = boundedBody.reason === 'too_large' ? 413 : 400;
    return jsonResponse({error: status === 413 ? 'Request is too large' : 'Invalid Content-Length'}, status, origin);
  }

  let form: FormData;
  try {
    const formHeaders = new Headers(request.headers);
    formHeaders.delete('content-length');
    const boundedRequest = new Request(request.url, {
      method: 'POST', headers: formHeaders, body: boundedBody.bytes
    });
    form = await boundedRequest.formData();
  }
  catch { return jsonResponse({error: 'Invalid form data'}, 400, origin); }
  const fields = validateSuggestionFields(form.get('name'), form.get('description'),
    form.get('lat'), form.get('lng'));
  if (!fields.ok) {
    const message = fields.reason === 'text_too_long' ? 'Nome ou descrição acima do limite permitido.'
      : fields.reason === 'missing_name' ? 'Informe o nome do local.'
      : fields.reason === 'invalid_coordinates' ? 'Marque uma localização válida no mapa.'
      : 'Nome ou coordenadas inválidas.';
    return jsonResponse({error: message}, 400, origin);
  }
  const {name, description, lat, lng} = fields;

  let file: File | null = null;
  const suppliedFile = form.get('photo');
  if (suppliedFile !== null && !(suppliedFile instanceof File)) {
    return jsonResponse({error: 'Arquivo de foto inválido.'}, 400, origin);
  }
  if (suppliedFile instanceof File) {
    if (suppliedFile.size === 0) return jsonResponse({error: 'A foto selecionada está vazia.'}, 400, origin);
    file = suppliedFile;
  }
  let bytes: Uint8Array | null = null;
  if (file) {
    bytes = new Uint8Array(await file.arrayBuffer());
    const imageValidation = validateImageFile(file, bytes);
    if (!imageValidation.ok) {
      const message = imageValidation.reason === 'image_too_large'
        ? 'A foto deve ter no máximo 5 MB.'
        : imageValidation.reason === 'image_signature_mismatch'
          ? 'O conteúdo da foto não corresponde ao formato declarado.'
          : 'A foto deve ser JPG, PNG ou WebP.';
      return jsonResponse({error: message}, 400, origin);
    }
  }

  const imagePath = file ? `${crypto.randomUUID()}.${MIME_EXTENSION[file.type]}` : null;
  const generatedPlaceId = crypto.randomUUID();
  const result = await runPlaceSubmission(
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
    let cleanupToken: string | undefined;
    if (cleanupPending) {
      const tokenSecret = Deno.env.get('CLEANUP_TOKEN_SECRET');
      if (tokenSecret) {
        try { cleanupToken = await createCleanupToken(imagePath!, tokenSecret); }
        catch (error) { console.error('Could not sign cleanup capability:', error); }
      }
    }
    return jsonResponse({
      error: 'Não foi possível salvar a sugestão.',
      cleanupPending: cleanupPending && Boolean(cleanupToken),
      imagePath: cleanupToken ? imagePath : undefined,
      cleanupToken
    }, 500, origin);
  }
  return jsonResponse({place_id: result.placeId, approved: false}, 201, origin);
});
