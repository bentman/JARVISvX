import 'dotenv/config';
import { startDaemon } from './lib/daemon.mjs';
const daemon = await startDaemon();
console.log(`JARVIS daemon listening at http://127.0.0.1:${daemon.port}`);
for (const signal of ['SIGINT', 'SIGTERM']) process.on(signal, () => daemon.close().finally(() => process.exit(0)));
