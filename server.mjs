// Development entry point deliberately uses the same singleton daemon as the
// desktop and CLI. It must never construct a second application/database.
import 'dotenv/config';
import { startDaemon, daemonDiscovery } from './lib/daemon.mjs';

let daemon;
try {
  daemon = await startDaemon();
  console.log(`JARVIS development daemon listening at http://127.0.0.1:${daemon.port}`);
  for (const signal of ['SIGINT', 'SIGTERM']) process.on(signal, () => daemon.close().finally(() => process.exit(0)));
} catch (error) {
  const existing = await daemonDiscovery();
  if (existing) {
    console.log(`JARVIS daemon is already running at http://127.0.0.1:${existing.port}`);
  } else {
    throw error;
  }
}

