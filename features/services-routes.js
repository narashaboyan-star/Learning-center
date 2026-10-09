const { LANGUAGES, SERVICE_KEYS, clean } = require('../server/contracts');

const SERVICE_DEFINITIONS = Object.freeze(
  Object.entries(SERVICE_KEYS).flatMap(([kind, keys]) => keys.map((key) => Object.freeze({ key, kind }))),
);
const SERVICE_BY_KEY = new Map(SERVICE_DEFINITIONS.map((service) => [service.key, service]));

function listServices(database) {
  const rows = database.prepare(`
    SELECT services.service_key, services.kind, services.sort_order,
           service_translations.language, service_translations.name, service_translations.description
    FROM services
    JOIN service_translations ON service_translations.service_id = services.id
    ORDER BY services.sort_order, service_translations.language
  `).all();

  const services = new Map(SERVICE_DEFINITIONS.map(({ key, kind }) => [key, {
    key,
    kind,
    sortOrder: 0,
    translations: {},
  }]));

  for (const row of rows) {
    const expected = SERVICE_BY_KEY.get(row.service_key);
    if (!expected || expected.kind !== row.kind || !LANGUAGES.includes(row.language)) continue;
    const service = services.get(row.service_key);
    service.sortOrder = row.sort_order;
    service.translations[row.language] = {
      name: row.name,
      description: row.description,
    };
  }

  return [...services.values()]
    .filter((service) => LANGUAGES.every((language) => service.translations[language]))
    .sort((left, right) => left.sortOrder - right.sortOrder);
}

function inputError(code) {
  const error = new Error(code);
  error.status = 400;
  return error;
}

function normalizeUpdate(body) {
  if (!body || typeof body !== 'object' || Array.isArray(body)) throw inputError('invalid_service');
  const fields = Object.keys(body);
  if (fields.some((field) => !['key', 'translations'].includes(field))) throw inputError('unsupported_field');
  const key = clean(body.key, 80);
  if (!SERVICE_BY_KEY.has(key)) throw inputError('unknown_service');
  if (!body.translations || typeof body.translations !== 'object' || Array.isArray(body.translations)) {
    throw inputError('invalid_translations');
  }

  const languages = Object.keys(body.translations);
  if (!languages.length) throw inputError('translations_required');
  if (languages.some((language) => !LANGUAGES.includes(language))) throw inputError('unknown_language');

  const translations = {};
  for (const language of languages) {
    const translation = body.translations[language];
    if (!translation || typeof translation !== 'object' || Array.isArray(translation)) {
      throw inputError('invalid_translation');
    }
    if (Object.keys(translation).some((field) => !['name', 'description'].includes(field))) {
      throw inputError('unsupported_translation_field');
    }
    const name = clean(translation.name, 120);
    const description = clean(translation.description, 1000);
    if (!name) throw inputError('service_name_required');
    translations[language] = { name, description };
  }

  return { key, translations };
}

function updateService(database, update) {
  const row = database.prepare('SELECT id FROM services WHERE service_key = ?').get(update.key);
  if (!row) throw inputError('unknown_service');
  const statement = database.prepare(`
    UPDATE service_translations
    SET name = ?, description = ?, updated_at = CURRENT_TIMESTAMP
    WHERE service_id = ? AND language = ?
  `);

  database.exec('BEGIN IMMEDIATE;');
  try {
    for (const [language, translation] of Object.entries(update.translations)) {
      const result = statement.run(translation.name, translation.description, row.id, language);
      if (result.changes !== 1) throw inputError('unknown_language');
    }
    database.prepare('UPDATE services SET updated_at = CURRENT_TIMESTAMP WHERE id = ?').run(row.id);
    database.exec('COMMIT;');
  } catch (error) {
    database.exec('ROLLBACK;');
    throw error;
  }

  return listServices(database).find((service) => service.key === update.key);
}

function sendRouteError(sendJson, error) {
  if (error.status === 400) return sendJson(400, { ok: false, code: error.message });
  throw error;
}

module.exports = [
  {
    method: 'GET',
    path: '/api/services',
    access: 'public',
    handle({ database, sendJson }) {
      return sendJson(200, { ok: true, services: listServices(database) });
    },
  },
  {
    method: 'GET',
    path: '/api/admin/services',
    access: 'owner',
    handle({ database, sendJson }) {
      return sendJson(200, { ok: true, services: listServices(database) });
    },
  },
  {
    method: 'PUT',
    path: '/api/admin/services',
    access: 'owner',
    async handle({ database, readJson, sendJson }) {
      try {
        const update = normalizeUpdate(await readJson());
        const service = updateService(database, update);
        return sendJson(200, { ok: true, service });
      } catch (error) {
        return sendRouteError(sendJson, error);
      }
    },
  },
];

module.exports.listServices = listServices;
module.exports.normalizeUpdate = normalizeUpdate;
