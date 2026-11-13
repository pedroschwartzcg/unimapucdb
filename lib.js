// Funções puras compartilhadas por index.html e admin.html.
// No navegador ficam em window.UM; no Node (testes) saem via module.exports.
(function (root) {
  'use strict';

  // Escapa texto para inserir com segurança em innerHTML / atributos.
  const esc = s => String(s == null ? '' : s).replace(/[&<>"']/g, c => '&#' + c.charCodeAt(0) + ';');

  // Minúsculas e sem acentos: "Biblioteca" casa com "biblioteca", "Cantina" com "cântina".
  const norm = s => String(s == null ? '' : s).normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase();

  // Busca por nome + categoria. Retorna no máximo `limit` locais.
  function filterPlaces(places, query, limit) {
    const q = norm(query).trim();
    if (!q) return [];
    return places.filter(p => norm(p.name + ' ' + p.cat).includes(q)).slice(0, limit == null ? 6 : limit);
  }

  // Pendentes (approved=false) primeiro; não altera o array original.
  const sortPendingFirst = places => places.slice().sort((a, b) => Number(!!a.approved) - Number(!!b.approved));

  // Comparação do e-mail do dev, sem diferença de maiúsculas/minúsculas ou espaços.
  function isDevEmail(email, dev) {
    const a = String(email == null ? '' : email).trim().toLowerCase();
    const b = String(dev == null ? '' : dev).trim().toLowerCase();
    return a !== '' && a === b;
  }

  const validCoords = (lat, lng) =>
    typeof lat === 'number' && typeof lng === 'number' &&
    isFinite(lat) && isFinite(lng) && lat >= -90 && lat <= 90 && lng >= -180 && lng <= 180;

  const directionsUrl = (lat, lng) =>
    'https://www.google.com/maps/dir/?api=1&destination=' + encodeURIComponent(lat + ',' + lng) + '&travelmode=walking';

  const MAX_IMAGE_SIZE = 5 * 1024 * 1024;
  const IMAGE_TYPES = Object.freeze({
    'image/jpeg': 'jpg',
    'image/png': 'png',
    'image/webp': 'webp'
  });

  function validateImageFile(file) {
    if (!file) return {ok: true, extension: null};
    const extension = IMAGE_TYPES[file.type];
    if (!extension) return {ok: false, message: 'Use uma imagem JPG, PNG ou WebP.'};
    if (!Number.isFinite(file.size) || file.size <= 0) return {ok: false, message: 'A imagem está vazia ou é inválida.'};
    if (file.size > MAX_IMAGE_SIZE) return {ok: false, message: 'A imagem deve ter no máximo 5 MB.'};
    return {ok: true, extension};
  }

  function sniffImageMime(bytes) {
    const data = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes || []);
    if (data.length >= 3 && data[0] === 0xff && data[1] === 0xd8 && data[2] === 0xff) return 'image/jpeg';
    const png = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];
    if (data.length >= png.length && png.every((byte, index) => data[index] === byte)) return 'image/png';
    if (data.length >= 12 && String.fromCharCode(...data.subarray(0, 4)) === 'RIFF' &&
        String.fromCharCode(...data.subarray(8, 12)) === 'WEBP') return 'image/webp';
    return null;
  }

  function validateSubmission(name, description, lat, lng, file) {
    const cleanName = String(name == null ? '' : name).trim().slice(0, 80);
    const cleanDescription = String(description == null ? '' : description).trim().slice(0, 500);
    if (!cleanName) return {ok: false, message: 'Informe o nome do local.'};
    if (!validCoords(lat, lng)) return {ok: false, message: 'Marque uma localização válida no mapa.'};
    const image = validateImageFile(file);
    if (!image.ok) return image;
    return {ok: true, name: cleanName, description: cleanDescription, imageExtension: image.extension};
  }

  // Removes the photo only after the administrator's requested row deletion succeeds.
  async function deletePlaceWithImageCleanup(deletePlace, deleteImage, imagePath) {
    let rowResult;
    try { rowResult = await deletePlace(); }
    catch (error) { return {placeDeleted: false, imageDeleted: false, error}; }
    if (rowResult && rowResult.error) return {placeDeleted: false, imageDeleted: false, error: rowResult.error};
    if (!imagePath) return {placeDeleted: true, imageDeleted: null, error: null};
    try {
      const imageResult = await deleteImage(imagePath);
      const error = imageResult && imageResult.error ? imageResult.error : null;
      return {placeDeleted: true, imageDeleted: !error, error};
    } catch (error) {
      return {placeDeleted: true, imageDeleted: false, error};
    }
  }

  // Shared compensation flow used by the trusted submission endpoint.
  async function runPlaceSubmission(uploadImage, insertPlace, insertDetails, rollbackPlace, removeImage) {
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

  // Converte o JSON importado em linhas para o banco. Itens inválidos são ignorados e listados em `skipped`.
  function buildImportRows(arr) {
    const rows = [], skipped = [];
    if (!Array.isArray(arr)) return {rows, skipped: [{index: -1, reason: 'o JSON precisa ser uma lista'}]};
    arr.forEach((p, index) => {
      if (!p || typeof p !== 'object') return skipped.push({index, reason: 'item inválido'});
      const name = String(p.name == null ? '' : p.name).trim().slice(0, 80);
      if (!name) return skipped.push({index, reason: 'sem nome'});
      const lat = Number(p.lat), lng = Number(p.lng);
      if (p.lat == null || p.lng == null || !validCoords(lat, lng)) return skipped.push({index, reason: 'coordenadas inválidas'});
      rows.push({
        name, cat: String(p.cat || 'Bloco').trim().slice(0, 60) || 'Bloco', lat, lng,
        w: Number(p.w) > 0 ? Number(p.w) : 40, h: Number(p.h) > 0 ? Number(p.h) : 26,
        autor: 'dev', approved: true
      });
    });
    return {rows, skipped};
  }

  const api = {esc, norm, filterPlaces, sortPendingFirst, isDevEmail, validCoords, directionsUrl, buildImportRows,
    MAX_IMAGE_SIZE, validateImageFile, sniffImageMime, validateSubmission, deletePlaceWithImageCleanup, runPlaceSubmission};
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.UM = api;
})(typeof window !== 'undefined' ? window : globalThis);
