const fs = require('node:fs');
const http = require('node:http');
const path = require('node:path');
const {
  COOKIE_NAME,
  authenticate,
  clearSessionCookie,
  confirmPasswordReset,
  createSession,
  ownerFromToken,
  parseCookies,
  requestPasswordReset,
  revokeSession,
  sessionCookie,
} = require('./auth');
const { openDatabase } = require('./database');
const { customerFromRequest } = require('./customer-auth');
const { loadFeatureRoutes, validateFeatureRoutes } = require('./feature-routes');
const { applyMigrations } = require('./migrations');
const { seedServices } = require('./seed-data');

const CONTENT_TYPES = {
  '.css': 'text/css; charset=utf-8',
  '.html': 'text/html; charset=utf-8',
  '.ico': 'image/x-icon',
  '.jpeg': 'image/jpeg',
  '.jpg': 'image/jpeg',
  '.js': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.png': 'image/png',
  '.svg': 'image/svg+xml',
  '.webp': 'image/webp',
};

function sendJson(response, status, body, headers = {}) {
  response.writeHead(status, { 'Content-Type': CONTENT_TYPES['.json'], 'Cache-Control': 'no-store', ...headers });
  response.end(JSON.stringify(body));
}

function redirect(response, location) {
  response.writeHead(302, { Location: location, 'Cache-Control': 'no-store' });
  response.end();
}

async function readJson(request) {
  let body = '';
  for await (const chunk of request) {
    body += chunk;
    if (body.length > 64 * 1024) throw new Error('body_too_large');
  }
  return body ? JSON.parse(body) : {};
}

function requestOwner(database, request) {
  const cookies = parseCookies(request.headers.cookie || '');
  return ownerFromToken(database, cookies[COOKIE_NAME]);
}

function isSameOrigin(request) {
  const origin = request.headers.origin;
  if (!origin) return true;
  return new URL(origin).host === request.headers.host;
}

function safeStaticPath(projectRoot, pathname) {
  const requested = pathname === '/' ? '/index.html' : pathname;
  const absolute = path.resolve(projectRoot, `.${requested}`);
  return absolute === projectRoot || absolute.startsWith(projectRoot + path.sep) ? absolute : null;
}

function createHttpApp(config, dependencies = {}) {
  const deliverPasswordReset = dependencies.deliverPasswordReset || (async () => {});
  const featureRoutes = validateFeatureRoutes(dependencies.featureRoutes || loadFeatureRoutes(config.projectRoot));
  const database = openDatabase(config.databasePath);
  applyMigrations(database, path.join(config.projectRoot, 'db', 'migrations'));
  seedServices(database);

  const handler = async (request, response) => {
    const url = new URL(request.url, `http://${request.headers.host || 'localhost'}`);
    const pathname = decodeURIComponent(url.pathname);

    try {
      if (request.method === 'GET' && pathname === '/api/health') {
        return sendJson(response, 200, { ok: true, environment: config.environment });
      }

      if (['POST', 'PUT', 'PATCH', 'DELETE'].includes(request.method) && !isSameOrigin(request)) {
        return sendJson(response, 403, { ok: false, code: 'origin_rejected' });
      }

      if (request.method === 'POST' && pathname === '/api/auth/login') {
        const body = await readJson(request);
        const owner = authenticate(database, body.email, body.password);
        if (!owner) return sendJson(response, 401, { ok: false, code: 'invalid_credentials' });
        const session = createSession(database, owner.id, config.sessionHours);
        return sendJson(response, 200, { ok: true, owner: { email: owner.email } }, {
          'Set-Cookie': sessionCookie(session.token, config.secureCookies),
        });
      }

      if (request.method === 'POST' && pathname === '/api/auth/logout') {
        const token = parseCookies(request.headers.cookie || '')[COOKIE_NAME];
        revokeSession(database, token);
        return sendJson(response, 200, { ok: true }, {
          'Set-Cookie': clearSessionCookie(config.secureCookies),
        });
      }

      if (request.method === 'POST' && pathname === '/api/auth/password-reset/request') {
        const body = await readJson(request);
        const token = requestPasswordReset(database, body.email);
        if (token) {
          await deliverPasswordReset({ email: String(body.email || '').trim(), token });
        }
        return sendJson(response, 202, { ok: true });
      }

      if (request.method === 'POST' && pathname === '/api/auth/password-reset/confirm') {
        const body = await readJson(request);
        const changed = confirmPasswordReset(database, body.token, body.password);
        return changed
          ? sendJson(response, 200, { ok: true })
          : sendJson(response, 400, { ok: false, code: 'invalid_or_expired_token' });
      }

      const featureRoute = featureRoutes.find((route) => route.method === request.method && route.path === pathname);
      if (featureRoute) {
        const owner = requestOwner(database, request);
        const customer = customerFromRequest(database, request);
        if (featureRoute.access === 'owner' && !owner) {
          return sendJson(response, 401, { ok: false, code: 'authentication_required' });
        }
        if (featureRoute.access === 'customer' && !customer) {
          return sendJson(response, 401, { ok: false, code: 'customer_authentication_required' });
        }
        return featureRoute.handle({
          config,
          database,
          owner,
          customer,
          readJson: () => readJson(request),
          request,
          response,
          sendJson: (status, body, headers) => sendJson(response, status, body, headers),
          url,
        });
      }

      if (pathname.startsWith('/api/admin/')) {
        const owner = requestOwner(database, request);
        if (!owner) return sendJson(response, 401, { ok: false, code: 'authentication_required' });
        if (request.method === 'GET' && pathname === '/api/admin/session') {
          return sendJson(response, 200, { ok: true, owner: { email: owner.email } });
        }
        return sendJson(response, 404, { ok: false, code: 'not_found' });
      }

      const publicAdminAssets = new Set(['/admin/login.html', '/admin/login.js', '/admin/shared.css']);
      if (pathname === '/admin') return redirect(response, '/admin/');
      if (pathname.startsWith('/admin/') && !publicAdminAssets.has(pathname)) {
        if (!requestOwner(database, request)) return redirect(response, '/admin/login.html');
      }
      if (pathname === '/admin/login.html' && requestOwner(database, request)) return redirect(response, '/admin/');

      if (request.method !== 'GET' && request.method !== 'HEAD') {
        response.writeHead(405, { Allow: 'GET, HEAD' });
        return response.end();
      }

      const staticPath = safeStaticPath(config.projectRoot, pathname === '/admin/' ? '/admin/index.html' : pathname);
      if (!staticPath || !fs.existsSync(staticPath) || !fs.statSync(staticPath).isFile()) {
        response.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
        return response.end('Not found');
      }
      response.writeHead(200, {
        'Content-Type': CONTENT_TYPES[path.extname(staticPath).toLowerCase()] || 'application/octet-stream',
        'X-Content-Type-Options': 'nosniff',
        'X-Frame-Options': 'DENY',
        'Referrer-Policy': 'same-origin',
      });
      if (request.method === 'HEAD') return response.end();
      fs.createReadStream(staticPath).pipe(response);
    } catch (error) {
      const isInputError = error instanceof SyntaxError || ['body_too_large', 'password_too_short'].includes(error.message);
      sendJson(response, isInputError ? 400 : 500, {
        ok: false,
        code: isInputError ? error.message : 'internal_error',
      });
    }
  };

  return {
    database,
    handler,
    listen(port = config.port, host = '127.0.0.1') {
      const server = http.createServer(handler);
      return new Promise((resolve, reject) => {
        server.once('error', reject);
        server.listen(port, host, () => resolve(server));
      });
    },
    close() {
      database.close();
    },
  };
}

module.exports = { createHttpApp };
