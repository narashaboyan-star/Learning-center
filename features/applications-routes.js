const { normalizeApplication } = require('../server/contracts');

const ITEM_SPECS = Object.freeze([
  { kind: 'service', key(application) { return 'trial-lesson'; } },
  { kind: 'lesson_type', key(application) { return application.lessonType; } },
  { kind: 'mode', key(application) { return application.mode; } },
]);

function escapeHtml(value) {
  return String(value ?? '')
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;');
}

function buildTelegramMessage(application) {
  const lessonTypes = { individual: 'Индивидуальное', group: 'Групповое' };
  const modes = { online: 'Онлайн', offline: 'Офлайн' };
  return [
    '<b>Новая заявка на пробное занятие</b>',
    '',
    `<b>Родитель:</b> ${escapeHtml(application.parentName)}`,
    `<b>Телефон:</b> ${escapeHtml(application.phone)}`,
    `<b>Ребёнок:</b> ${escapeHtml(application.childName)}`,
    `<b>Класс:</b> ${escapeHtml(application.grade)}`,
    `<b>Тип занятия:</b> ${escapeHtml(lessonTypes[application.lessonType] || application.lessonType)}`,
    `<b>Способ участия:</b> ${escapeHtml(modes[application.mode] || application.mode)}`,
    `<b>Суть заявки:</b> ${escapeHtml(application.helpNeeded || 'Не указано')}`,
    `<b>Язык сайта:</b> ${escapeHtml(application.language)}`,
  ].join('\n');
}

function telegramErrorCode(response, result) {
  const description = String(result?.description || '').toLowerCase();
  if (response?.status === 401 || description.includes('unauthorized') || description.includes('token')) {
    return 'invalid_bot_token';
  }
  if (description.includes('chat not found')) return 'chat_not_found';
  if (response?.status === 403 || description.includes('blocked') || description.includes('deactivated')) {
    return 'bot_unavailable';
  }
  return 'telegram_rejected';
}

function snapshotName(database, kind, key, language) {
  const row = database.prepare(`
    SELECT COALESCE(requested.name, fallback.name, services.service_key) AS name
    FROM services
    LEFT JOIN service_translations AS requested
      ON requested.service_id = services.id AND requested.language = ?
    LEFT JOIN service_translations AS fallback
      ON fallback.service_id = services.id AND fallback.language = 'ru'
    WHERE services.kind = ? AND services.service_key = ?
  `).get(language, kind, key);
  if (!row) throw new Error('service_not_found');
  return row.name;
}

function saveApplication(database, application) {
  database.exec('BEGIN IMMEDIATE;');
  try {
    const inserted = database.prepare(`
      INSERT INTO applications (parent_name, phone, child_name, grade, help_needed, language)
      VALUES (?, ?, ?, ?, ?, ?)
    `).run(
      application.parentName,
      application.phone,
      application.childName,
      application.grade,
      application.helpNeeded,
      application.language,
    );
    const applicationId = Number(inserted.lastInsertRowid);
    const insertItem = database.prepare(`
      INSERT INTO application_items (application_id, item_kind, item_key, name_snapshot)
      VALUES (?, ?, ?, ?)
    `);
    for (const spec of ITEM_SPECS) {
      const key = spec.key(application);
      insertItem.run(applicationId, spec.kind, key, snapshotName(database, spec.kind, key, application.language));
    }
    database.exec('COMMIT;');
    return applicationId;
  } catch (error) {
    database.exec('ROLLBACK;');
    throw error;
  }
}

function recordTelegramResult(database, applicationId, errorCode = null) {
  if (errorCode) {
    database.prepare(`
      UPDATE applications
      SET telegram_notified_at = NULL, telegram_error_code = ?
      WHERE id = ?
    `).run(errorCode, applicationId);
    return;
  }
  database.prepare(`
    UPDATE applications
    SET telegram_notified_at = CURRENT_TIMESTAMP, telegram_error_code = NULL
    WHERE id = ?
  `).run(applicationId);
}

async function deliverTelegram(application, dependencies) {
  const token = dependencies.env.TELEGRAM_BOT_TOKEN;
  const chatId = dependencies.env.TELEGRAM_CHAT_ID;
  if (!token || !chatId) return { ok: false, status: 503, code: 'configuration_missing' };

  try {
    const botResponse = await dependencies.fetchImpl(`https://api.telegram.org/bot${token}/getMe`);
    const botResult = await botResponse.json().catch(() => ({}));
    if (!botResponse.ok || botResult.ok !== true) {
      return { ok: false, status: 502, code: telegramErrorCode(botResponse, botResult) };
    }

    const telegramResponse = await dependencies.fetchImpl(`https://api.telegram.org/bot${token}/sendMessage`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        chat_id: chatId,
        text: buildTelegramMessage(application),
        parse_mode: 'HTML',
        disable_web_page_preview: true,
      }),
    });
    const telegramResult = await telegramResponse.json().catch(() => ({}));
    if (!telegramResponse.ok || telegramResult.ok !== true) {
      return { ok: false, status: 502, code: telegramErrorCode(telegramResponse, telegramResult) };
    }
    return { ok: true };
  } catch {
    return { ok: false, status: 502, code: 'telegram_unavailable' };
  }
}

function mapApplication(row, items) {
  return {
    id: row.id,
    parentName: row.parent_name,
    phone: row.phone,
    childName: row.child_name,
    grade: row.grade,
    helpNeeded: row.help_needed,
    language: row.language,
    telegram: {
      notifiedAt: row.telegram_notified_at,
      errorCode: row.telegram_error_code,
    },
    createdAt: row.created_at,
    ...(items ? {
      items: items.map((item) => ({
        kind: item.item_kind,
        key: item.item_key,
        name: item.name_snapshot,
        quantity: item.quantity,
      })),
    } : {}),
  };
}

function listApplications(database) {
  return database.prepare(`
    SELECT * FROM applications ORDER BY created_at DESC, id DESC LIMIT 200
  `).all().map((row) => mapApplication(row));
}

function applicationDetails(database, id) {
  const row = database.prepare('SELECT * FROM applications WHERE id = ?').get(id);
  if (!row) return null;
  const items = database.prepare(`
    SELECT item_kind, item_key, name_snapshot, quantity
    FROM application_items WHERE application_id = ? ORDER BY id
  `).all(id);
  return mapApplication(row, items);
}

function createApplicationRoutes(overrides = {}) {
  const dependencies = {
    env: overrides.env || process.env,
    fetchImpl: overrides.fetchImpl || globalThis.fetch,
  };
  return [
    {
      method: 'POST',
      path: '/api/telegram',
      access: 'public',
      async handle({ database, readJson, sendJson }) {
        let application;
        try {
          application = normalizeApplication(await readJson());
        } catch (error) {
          const allowed = new Set([
            'required_fields_missing',
            'invalid_phone',
            'invalid_language',
            'invalid_lesson_type',
            'invalid_mode',
          ]);
          const code = allowed.has(error.message) ? error.message : 'invalid_request_body';
          return sendJson(400, { ok: false, code, error: 'Invalid application data' });
        }

        const applicationId = saveApplication(database, application);
        const delivery = await deliverTelegram(application, dependencies);
        if (!delivery.ok) {
          recordTelegramResult(database, applicationId, delivery.code);
          return sendJson(delivery.status, {
            ok: false,
            code: delivery.code,
            error: delivery.code === 'configuration_missing'
              ? 'Telegram delivery is not configured'
              : 'Telegram notification was not delivered',
          });
        }
        recordTelegramResult(database, applicationId);
        return sendJson(200, { ok: true });
      },
    },
    {
      method: 'GET',
      path: '/api/admin/applications',
      access: 'owner',
      handle({ database, sendJson, url }) {
        if (!url.searchParams.has('id')) {
          return sendJson(200, { ok: true, applications: listApplications(database) });
        }
        const rawId = url.searchParams.get('id');
        const id = Number(rawId);
        if (!/^\d+$/.test(rawId || '') || !Number.isSafeInteger(id) || id < 1) {
          return sendJson(400, { ok: false, code: 'invalid_application_id' });
        }
        const application = applicationDetails(database, id);
        return application
          ? sendJson(200, { ok: true, application })
          : sendJson(404, { ok: false, code: 'application_not_found' });
      },
    },
  ];
}

const routes = createApplicationRoutes();
module.exports = routes;
module.exports.createApplicationRoutes = createApplicationRoutes;
module.exports.buildTelegramMessage = buildTelegramMessage;
module.exports.saveApplication = saveApplication;
module.exports.applicationDetails = applicationDetails;
