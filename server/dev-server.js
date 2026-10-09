const { loadConfig } = require('./config');
const { createHttpApp } = require('./http-app');

const config = loadConfig();
const app = createHttpApp(config);

app.listen().then((server) => {
  process.stdout.write(`Local test server: http://127.0.0.1:${server.address().port}\n`);
});

function shutdown() {
  app.close();
  process.exit(0);
}

process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);
