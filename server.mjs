// Development entry point deliberately uses the same singleton daemon as the
// desktop and CLI. It must never construct a second application/database.
import 'dotenv/config';
import { startDaemon } from './lib/daemon.mjs';

const daemon = await startDaemon();
console.log(`JARVIS development daemon listening at http://127.0.0.1:${daemon.port}`);
for (const signal of ['SIGINT', 'SIGTERM']) process.on(signal, () => daemon.close().finally(() => process.exit(0)));

