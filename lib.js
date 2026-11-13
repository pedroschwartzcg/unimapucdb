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

  function validateSubmission(name, description, lat, lng, file) {
    const cleanName = String(name == null ? '' : name).trim().slice(0, 80);
    const cleanDescription = String(description == null ? '' : description).trim().slice(0, 500);
    if (!cleanName) return {ok: false, message: 'Informe o nome do local.'};
    if (!validCoords(lat, lng)) return {ok: false, message: 'Marque uma localização válida no mapa.'};
    const image = validateImageFile(file);
    if (!image.ok) return image;
    return {ok: true, name: cleanName, description: cleanDescription, imageExtension: image.extension};
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
    MAX_IMAGE_SIZE, validateImageFile, validateSubmission};
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.UM = api;
})(typeof window !== 'undefined' ? window : globalThis);
