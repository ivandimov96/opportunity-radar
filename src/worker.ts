/** Standalone worker process: `pnpm worker`. Use with EMBEDDED_WORKER=false. */
import { getDb } from "@/db/client";
import { startWorker, stopWorker } from "@/lib/jobs/worker";

await getDb();
startWorker();
const shutdown = () => {
  stopWorker();
  setTimeout(() => process.exit(0), 200);
};
process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);
setInterval(() => {}, 1 << 30);
