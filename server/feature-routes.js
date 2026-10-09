const path = require('node:path');

const FEATURE_FILES = Object.freeze([
  'features/services-routes.js',
  'features/applications-routes.js',
]);

function loadFeatureRoutes(projectRoot) {
  return FEATURE_FILES.flatMap((relativePath) => {
    const absolutePath = path.join(projectRoot, relativePath);
    try {
      const routes = require(absolutePath);
      if (!Array.isArray(routes)) throw new Error(`${relativePath} must export an array.`);
      return routes;
    } catch (error) {
      if (error.code === 'MODULE_NOT_FOUND' && error.message.includes(absolutePath)) return [];
      throw error;
    }
  });
}

function validateFeatureRoutes(routes) {
  for (const route of routes) {
    if (!['GET', 'POST', 'PUT'].includes(route.method)) throw new Error('Unsupported feature route method.');
    if (!String(route.path).startsWith('/api/')) throw new Error('Feature routes must stay below /api/.');
    if (!['public', 'owner'].includes(route.access)) throw new Error('Feature route access must be public or owner.');
    if (route.path.startsWith('/api/admin/') && route.access !== 'owner') {
      throw new Error('Admin feature routes must require owner access.');
    }
    if (typeof route.handle !== 'function') throw new Error('Feature route handle must be a function.');
  }
  return routes;
}

module.exports = { FEATURE_FILES, loadFeatureRoutes, validateFeatureRoutes };
