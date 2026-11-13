const test = require('node:test');
const assert = require('node:assert/strict');
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
