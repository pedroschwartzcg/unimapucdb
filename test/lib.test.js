const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const UM = require('../lib.js');

test('validateImageFile aceita JPG, PNG e WebP até 5 MB', () => {
  assert.deepEqual(UM.validateImageFile({type: 'image/jpeg', size: UM.MAX_IMAGE_SIZE}), {ok: true, extension: 'jpg'});
  assert.equal(UM.validateImageFile({type: 'image/png', size: 10}).extension, 'png');
  assert.equal(UM.validateImageFile({type: 'image/webp', size: 10}).extension, 'webp');
});

test('validateImageFile recusa formatos não permitidos, arquivos vazios e maiores que 5 MB', () => {
  assert.equal(UM.validateImageFile({type: 'image/gif', size: 20}).ok, false);
  assert.equal(UM.validateImageFile({type: 'image/png', size: 0}).ok, false);
  assert.equal(UM.validateImageFile({type: 'image/jpeg', size: UM.MAX_IMAGE_SIZE + 1}).ok, false);
  assert.equal(UM.validateImageFile(null).ok, true);
});

test('sniffImageMime confere assinatura binária de JPEG, PNG e WebP', () => {
  assert.equal(UM.sniffImageMime(new Uint8Array([0xff, 0xd8, 0xff, 0x00])), 'image/jpeg');
  assert.equal(UM.sniffImageMime(new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])), 'image/png');
  assert.equal(UM.sniffImageMime(new TextEncoder().encode('RIFFxxxxWEBPdata')), 'image/webp');
  assert.equal(UM.sniffImageMime(new TextEncoder().encode('not an image')), null);
});

test('validateSubmission normaliza nome/descrição e valida coordenadas e imagem', () => {
  assert.deepEqual(UM.validateSubmission('  Biblioteca  ', '  Bloco central  ', -20.4, -54.6, null), {
    ok: true, name: 'Biblioteca', description: 'Bloco central', imageExtension: null
  });
  assert.equal(UM.validateSubmission('', '', -20.4, -54.6, null).ok, false);
  assert.equal(UM.validateSubmission('Local', '', 100, 0, null).ok, false);
  assert.equal(UM.validateSubmission('Local', '', -20.4, -54.6, {type: 'image/gif', size: 1}).ok, false);
  assert.equal(UM.validateSubmission('X'.repeat(90), 'Y'.repeat(510), -20.4, -54.6, null).name.length, 80);
  assert.equal(UM.validateSubmission('Local', 'Y'.repeat(510), -20.4, -54.6, null).description.length, 500);
});

test('busca e escape de HTML existentes continuam funcionando', () => {
  assert.equal(UM.filterPlaces([{name: 'Biblioteca', cat: 'Estudo'}], 'biblioteca').length, 1);
  assert.equal(UM.esc('<b>'), '&#60;b&#62;');
});

test('falha na inserção da place remove a imagem já enviada', async () => {
  const calls = [];
  const result = await UM.runPlaceSubmission(
    async () => ({path: 'abc.jpg'}),
    async () => ({error: new Error('insert failed')}),
    async () => { calls.push('details'); },
    async () => { calls.push('rollback'); },
    async path => { calls.push(`remove:${path}`); return {error: null}; }
  );
  assert.equal(result.ok, false);
  assert.deepEqual(calls, ['remove:abc.jpg']);
  assert.equal(result.cleanupError, null);
});

test('erro de upload com caminho conhecido também tenta a compensação', async () => {
  const calls = [];
  const result = await UM.runPlaceSubmission(
    async () => ({path: 'uncertain-upload.jpg', error: new Error('upload response failed')}),
    async () => ({error: null}),
    async () => ({error: null}),
    async () => ({error: null}),
    async path => { calls.push(path); return {error: null}; }
  );
  assert.equal(result.ok, false);
  assert.deepEqual(calls, ['uncertain-upload.jpg']);
});

test('falha nos metadados reverte a place recém-criada antes de limpar a foto', async () => {
  const calls = [];
  const result = await UM.runPlaceSubmission(
    async () => ({path: 'abc.png'}),
    async () => ({data: {id: 'new-place'}, error: null}),
    async () => ({error: new Error('details failed')}),
    async id => { calls.push(`rollback:${id}`); return {error: null}; },
    async path => { calls.push(`remove:${path}`); return {error: null}; }
  );
  assert.deepEqual(calls, ['rollback:new-place', 'remove:abc.png']);
  assert.equal(result.ok, false);
});

test('falha de rollback impede remover uma foto possivelmente vinculada', async () => {
  const calls = [];
  const result = await UM.runPlaceSubmission(
    async () => ({path: 'abc.webp'}),
    async () => ({data: {id: 'new-place'}, error: null}),
    async () => ({error: new Error('details failed')}),
    async () => ({error: new Error('rollback failed')}),
    async () => { calls.push('remove'); return {error: null}; }
  );
  assert.deepEqual(calls, []);
  assert.ok(result.rollbackError);
  assert.ok(result.cleanupError);
});

test('exclusão administrativa só tenta remover a foto após excluir a linha', async () => {
  const calls = [];
  const failedRow = await UM.deletePlaceWithImageCleanup(
    async () => ({error: new Error('row delete failed')}),
    async () => { calls.push('image'); return {error: null}; },
    'abc.jpg'
  );
  assert.equal(failedRow.placeDeleted, false);
  assert.deepEqual(calls, []);

  const failedImage = await UM.deletePlaceWithImageCleanup(
    async () => ({error: null}),
    async () => { calls.push('image'); return {error: new Error('storage delete denied')}; },
    'abc.jpg'
  );
  assert.equal(failedImage.placeDeleted, true);
  assert.equal(failedImage.imageDeleted, false);
  assert.deepEqual(calls, ['image']);
});

test('migração preserva places e não remove policies existentes', () => {
  const sql = fs.readFileSync(path.join(__dirname, '../supabase/migrations/20261113000000_add_submission_media.sql'), 'utf8');
  assert.doesNotMatch(sql, /alter\s+table\s+public\.places/i);
  assert.doesNotMatch(sql, /drop\s+policy/i);
  assert.match(sql, /create\s+table\s+if\s+not\s+exists\s+public\.place_submission_details/i);
});

test('policies da migração restringem upload, leitura e exclusão no bucket', () => {
  const sql = fs.readFileSync(path.join(__dirname, '../supabase/migrations/20261113000000_add_submission_media.sql'), 'utf8');
  assert.match(sql, /metadata\s*->>\s*'mimetype'/i);
  assert.match(sql, /metadata\s*->>\s*'size'/i);
  assert.match(sql, /unimap_place_images_server_insert_only[\s\S]*?with\s+check\s*\(bucket_id\s*<>\s*'place-images'\s+or\s+public\.is_dev\(\)\)/i);
  assert.match(sql, /unimap_place_images_select_guard[\s\S]*?public\.is_dev\(\)[\s\S]*?p\.approved\s*=\s*true/i);
  assert.match(sql, /unimap_place_images_delete_guard[\s\S]*?bucket_id\s*<>\s*'place-images'\s+or\s+public\.is_dev\(\)/i);
  assert.match(sql, /unimap_place_images_admin_delete[\s\S]*?for\s+delete\s+to\s+authenticated[\s\S]*?public\.is_dev\(\)/i);
  assert.doesNotMatch(sql, /create\s+policy\s+\w+\s+on\s+storage\.objects\s+for\s+delete\s+to\s+anon/i);
});
