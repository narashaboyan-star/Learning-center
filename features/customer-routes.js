const { clean } = require('../server/contracts');
const {
  CUSTOMER_COOKIE_NAME,
  OIDC_BROWSER_COOKIE_NAME,
  beginOidc,
  clearCookie,
  consumeOidcTransaction,
  cookie,
  createCustomerSession,
  exchangeTelegramCode,
  revokeCustomerSession,
  safeReturnPath,
  upsertCustomer,
} = require('../server/customer-auth');
const {
  customerApplicationDetails,
  listCustomerApplications,
} = require('./applications-routes');
const { parseCookies } = require('../server/auth');

function profilePayload(customer) {
  return {
    parentName: customer?.parent_name || '',
    phone: customer?.phone || '',
  };
}

function validateProfile(body) {
  const parentName = clean(body.parentName, 120);
  const phone = clean(body.phone, 80);
  if (!parentName) throw new Error('parent_name_required');
  if (!/^0\d{8}$/.test(phone)) throw new Error('invalid_phone');
  return { parentName, phone };
}

function customerCookie(session, config) {
  return cookie(CUSTOMER_COOKIE_NAME, session.token, {
    maxAge: config.customerSessionHours * 60 * 60,
    secure: config.secureCookies,
    sameSite: 'Strict',
  });
}

function redirect(response, location, headers = {}) {
  response.writeHead(302, { Location: location, 'Cache-Control': 'no-store', ...headers });
  response.end();
}

function createCustomerRoutes(overrides = {}) {
  const fetchImpl = overrides.fetchImpl || globalThis.fetch;
  return [
    {
      method: 'GET',
      path: '/api/customer/session',
      access: 'public',
      handle({ config, customer, sendJson }) {
        return sendJson(200, {
          ok: true,
          authenticated: Boolean(customer),
          authMode: config.customerAuthMode,
          customer: customer ? { profile: profilePayload(customer) } : null,
        });
      },
    },
    {
      method: 'POST',
      path: '/api/customer/auth/mock',
      access: 'public',
      async handle({ config, database, readJson, sendJson }) {
        if (config.customerAuthMode !== 'mock') return sendJson(404, { ok: false, code: 'not_found' });
        const body = await readJson();
        const persona = ['parent-a', 'parent-b'].includes(body.persona) ? body.persona : 'parent-a';
        const account = upsertCustomer(database, 'mock', persona, {
          name: persona === 'parent-a' ? 'Тестовый родитель A' : 'Тестовый родитель B',
        });
        const session = createCustomerSession(database, account.id, config.customerSessionHours);
        return sendJson(200, { ok: true }, { 'Set-Cookie': customerCookie(session, config) });
      },
    },
    {
      method: 'GET',
      path: '/api/customer/auth/telegram/start',
      access: 'public',
      handle({ config, database, response, sendJson, url }) {
        try {
          const flow = beginOidc(database, config, url.searchParams.get('return'));
          return redirect(response, flow.authorizationUrl, {
            'Set-Cookie': cookie(OIDC_BROWSER_COOKIE_NAME, flow.browserToken, {
              maxAge: 600,
              secure: true,
              sameSite: 'Lax',
            }),
          });
        } catch (error) {
          return sendJson(503, { ok: false, code: error.message });
        }
      },
    },
    {
      method: 'GET',
      path: '/api/customer/auth/telegram/callback',
      access: 'public',
      async handle({ config, database, request, response, url }) {
        const browserToken = parseCookies(request.headers.cookie || '')[OIDC_BROWSER_COOKIE_NAME];
        const transaction = consumeOidcTransaction(database, url.searchParams.get('state'), browserToken);
        const returnPath = transaction?.return_path || safeReturnPath();
        if (!transaction || url.searchParams.get('error') || !url.searchParams.get('code')) {
          return redirect(response, `${returnPath}&auth=cancelled`, {
            'Set-Cookie': clearCookie(OIDC_BROWSER_COOKIE_NAME, true),
          });
        }
        try {
          const claims = await exchangeTelegramCode(config, transaction, url.searchParams.get('code'), fetchImpl);
          const account = upsertCustomer(database, 'telegram', claims.sub, claims);
          const session = createCustomerSession(database, account.id, config.customerSessionHours);
          return redirect(response, `${returnPath}&auth=success`, {
            'Set-Cookie': [customerCookie(session, config), clearCookie(OIDC_BROWSER_COOKIE_NAME, true)],
          });
        } catch {
          return redirect(response, `${returnPath}&auth=failed`, {
            'Set-Cookie': clearCookie(OIDC_BROWSER_COOKIE_NAME, true),
          });
        }
      },
    },
    {
      method: 'POST',
      path: '/api/customer/logout',
      access: 'public',
      handle({ config, database, request, sendJson }) {
        revokeCustomerSession(database, request);
        return sendJson(200, { ok: true }, {
          'Set-Cookie': clearCookie(CUSTOMER_COOKIE_NAME, config.secureCookies),
        });
      },
    },
    {
      method: 'GET',
      path: '/api/customer/profile',
      access: 'customer',
      handle({ customer, sendJson }) {
        return sendJson(200, { ok: true, profile: profilePayload(customer) });
      },
    },
    {
      method: 'PUT',
      path: '/api/customer/profile',
      access: 'customer',
      async handle({ customer, database, readJson, sendJson }) {
        try {
          const profile = validateProfile(await readJson());
          database.prepare(`
            UPDATE customer_profiles
            SET parent_name = ?, phone = ?, updated_at = CURRENT_TIMESTAMP
            WHERE customer_id = ?
          `).run(profile.parentName, profile.phone, customer.id);
          return sendJson(200, { ok: true, profile });
        } catch (error) {
          const code = ['parent_name_required', 'invalid_phone'].includes(error.message)
            ? error.message
            : 'invalid_profile';
          return sendJson(400, { ok: false, code });
        }
      },
    },
    {
      method: 'GET',
      path: '/api/customer/applications',
      access: 'customer',
      handle({ customer, database, sendJson, url }) {
        if (!url.searchParams.has('id')) {
          return sendJson(200, { ok: true, applications: listCustomerApplications(database, customer.id) });
        }
        const rawId = url.searchParams.get('id');
        const id = Number(rawId);
        if (!/^\d+$/.test(rawId || '') || !Number.isSafeInteger(id) || id < 1) {
          return sendJson(400, { ok: false, code: 'invalid_application_id' });
        }
        const application = customerApplicationDetails(database, customer.id, id);
        return application
          ? sendJson(200, { ok: true, application })
          : sendJson(404, { ok: false, code: 'application_not_found' });
      },
    },
  ];
}

const routes = createCustomerRoutes();
module.exports = routes;
module.exports.createCustomerRoutes = createCustomerRoutes;
module.exports.validateProfile = validateProfile;
