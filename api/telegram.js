const MAX_FIELD_LENGTH = 1000;

function clean(value, maxLength = MAX_FIELD_LENGTH) {
  return String(value ?? '').trim().slice(0, maxLength);
}

function escapeHtml(value) {
  return clean(value)
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;');
}

function parseBody(body) {
  if (body && typeof body === 'object') return body;
  if (typeof body === 'string') return JSON.parse(body);
  return {};
}

function labelFor(value, labels) {
  return labels[value] || value;
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

function buildMessage(data) {
  const lessonTypes = { individual: 'Индивидуальное', group: 'Групповое' };
  const modes = { online: 'Онлайн', offline: 'Офлайн' };
  const help = data.helpNeeded || 'Не указано';

  return [
    '<b>Новая заявка на пробное занятие</b>',
    '',
    `<b>Родитель:</b> ${escapeHtml(data.parentName)}`,
    `<b>Телефон:</b> ${escapeHtml(data.phone)}`,
    `<b>Ребёнок:</b> ${escapeHtml(data.childName)}`,
    `<b>Класс:</b> ${escapeHtml(data.grade)}`,
    `<b>Тип занятия:</b> ${escapeHtml(labelFor(data.lessonType, lessonTypes))}`,
    `<b>Способ участия:</b> ${escapeHtml(labelFor(data.mode, modes))}`,
    `<b>Суть заявки:</b> ${escapeHtml(help)}`,
    `<b>Язык сайта:</b> ${escapeHtml(data.language || 'ru')}`,
  ].join('\n');
}

module.exports = async function handler(request, response) {
  if (request.method !== 'POST') {
    response.setHeader('Allow', 'POST');
    return response.status(405).json({ ok: false, error: 'Method not allowed' });
  }

  let data;
  try {
    const body = parseBody(request.body);
    data = {
      parentName: clean(body.parentName, 120),
      phone: clean(body.phone, 80),
      childName: clean(body.childName, 120),
      grade: clean(body.grade, 20),
      lessonType: clean(body.lessonType, 30),
      mode: clean(body.mode, 30),
      helpNeeded: clean(body.helpNeeded),
      language: clean(body.language, 10),
    };
  } catch {
    return response.status(400).json({ ok: false, error: 'Invalid request body' });
  }

  const required = ['parentName', 'phone', 'childName', 'grade', 'lessonType', 'mode'];
  if (required.some((field) => !data[field])) {
    return response.status(400).json({ ok: false, error: 'Required fields are missing' });
  }

  if (!/^0\d{8}$/.test(data.phone)) {
    return response.status(400).json({ ok: false, code: 'invalid_phone', error: 'A valid Armenian phone number is required' });
  }

  const token = process.env.TELEGRAM_BOT_TOKEN;
  const chatId = process.env.TELEGRAM_CHAT_ID;
  if (!token || !chatId) {
    return response.status(503).json({ ok: false, code: 'configuration_missing', error: 'Telegram delivery is not configured' });
  }

  try {
    const botResponse = await fetch(`https://api.telegram.org/bot${token}/getMe`);
    const botResult = await botResponse.json().catch(() => ({}));
    if (!botResponse.ok || botResult.ok !== true) {
      return response.status(502).json({
        ok: false,
        code: telegramErrorCode(botResponse, botResult),
        error: 'Telegram rejected the bot credentials',
      });
    }

    const telegramResponse = await fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        chat_id: chatId,
        text: buildMessage(data),
        parse_mode: 'HTML',
        disable_web_page_preview: true,
      }),
    });

    const telegramResult = await telegramResponse.json().catch(() => ({}));
    if (!telegramResponse.ok || telegramResult.ok !== true) {
      return response.status(502).json({
        ok: false,
        code: telegramErrorCode(telegramResponse, telegramResult),
        error: 'Telegram rejected the request',
      });
    }

    return response.status(200).json({ ok: true });
  } catch {
    return response.status(502).json({ ok: false, code: 'telegram_unavailable', error: 'Telegram is temporarily unavailable' });
  }
};

module.exports.buildMessage = buildMessage;
module.exports.telegramErrorCode = telegramErrorCode;
