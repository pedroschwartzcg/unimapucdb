const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.join(__dirname, '..');
const read = file => fs.readFileSync(path.join(root, file), 'utf8');

test('frontend submits selected map coordinates and optional description/photo', () => {
  const page = read('index.html');
  assert.match(page, /<input id="placeName" maxlength="80" required/);
  assert.match(page, /<textarea id="placeDescription" maxlength="500"/);
  assert.match(page, /<input id="placePhoto" type="file" accept="image\/jpeg,image\/png,image\/webp"/);
  assert.match(page, /map\.on\('click',[\s\S]*?openForm\(\{lat: event\.latlng\.lat, lng: event\.latlng\.lng\}\)/);
  assert.match(page, /body\.set\('lat', String\(selectedCoords\.lat\)\)/);
  assert.match(page, /body\.set\('lng', String\(selectedCoords\.lng\)\)/);
  assert.match(page, /body\.set\('description', values\.description\)/);
  assert.match(page, /body\.set\('photo', file, file\.name\)/);
  assert.match(page, /headers:\s*\{apikey:\s*CFG\.KEY\}/);
  assert.doesNotMatch(page, /Authorization:\s*['"]Bearer ['"]\s*\+/);
  assert.doesNotMatch(page, /sb\.from\('places'\)\.insert/);
});

test('public display and admin review use the existing approval and RLS boundaries', () => {
  const page = read('index.html');
  const admin = read('admin.html');
  const schema = read('schema.sql');
  const migration = read('supabase/migrations/20261113000000_add_submission_media.sql');
  assert.match(schema, /publico ve aprovados[\s\S]*?using\s*\(approved\s+or\s+public\.is_dev\(\)\)/i);
  assert.match(page, /sb\.from\('places'\)\.select\('\*'\)\.eq\('approved',\s*true\)/);
  assert.match(page, /\.from\('place_submission_details'\)[\s\S]*?\.in\('place_id',\s*approvedPlaces\.map/);
  assert.match(migration, /unimap_place_images_select_guard[\s\S]*?p\.approved\s*=\s*true/i);
  assert.match(admin, /UM\.isDevEmail\(session\.user\.email, CFG\.DEV_EMAIL\)/);
  assert.match(admin, /createSignedUrl\(p\.image_path, 3600\)/);
  assert.match(admin, /Aprovar[\s\S]*?Rejeitar[\s\S]*?Reabrir análise/);
  assert.match(admin, /saveReviewState\(false\)[\s\S]*?update\(\{approved: true\}\)/);
  assert.match(admin, /saveReviewState\(true\)[\s\S]*?update\(\{approved: false\}\)/);
  assert.match(admin, /saveReviewState\(false\)[\s\S]*?update\(\{approved: false\}\)/);
  assert.match(admin, /storage\.from\('place-images'\)\.remove\(\[path\]\)/);
  assert.match(admin, /foto não pôde ser removida do Storage/);
  assert.doesNotMatch(admin, /approved:\s*true,\s*rejected:/);
});

test('localização é exibida localmente e não anexada ao pedido de sugestão', () => {
  const page = read('index.html');
  const locationLogic = page.match(/function stopLocationWatch\(\)[\s\S]*?\$\('location'\)\.onclick = localizarAluno;/)?.[0];
  assert.ok(locationLogic);
  assert.match(locationLogic, /navigator\.geolocation\.watchPosition/);
  assert.match(locationLogic, /navigator\.geolocation\.clearWatch/);
  assert.doesNotMatch(locationLogic, /fetch\(|FormData|body\.set/);
  const suggestionRequest = page.match(/const body = new FormData\(\);[\s\S]*?if \(file\) body\.set\('photo'[\s\S]*?\n\s*\}/)?.[0];
  assert.ok(suggestionRequest);
  assert.doesNotMatch(suggestionRequest, /position\.coords/);
});

test('secrets de servidor não estão no frontend nem na configuração publicável', () => {
  const publicFiles = ['index.html', 'admin.html', 'lib.js', 'config.js'].map(read).join('\n');
  assert.doesNotMatch(publicFiles, /SUPABASE_SERVICE_ROLE_KEY|CLEANUP_TOKEN_SECRET|RATE_LIMIT_SALT/);
});

test('CI valida Node e Edge Function imports sem credenciais ou deploy', () => {
  const workflow = read('.github/workflows/validate.yml');
  assert.match(workflow, /npm ci[\s\S]*npm test/);
  assert.match(workflow, /deno check --frozen-lockfile supabase\/functions\/submit-place-suggestion\/index\.ts supabase\/functions\/cleanup-orphaned-place-image\/index\.ts/);
  assert.doesNotMatch(workflow, /supabase functions deploy|secrets set|SUPABASE_SERVICE_ROLE_KEY/);
});
