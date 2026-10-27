/**
 * Processes queued jobs. Used by serverless hosts (e.g. a Vercel cron or a
 * manual call) where no long-lived worker exists. Locally the embedded worker
 * makes this unnecessary. Protected by CRON_SECRET when that variable is set.
 */
import { drainQueue } from "@/lib/jobs/worker";
import { jobCounts } from "@/lib/jobs/queue";

export const dynamic = "force-dynamic";
export const maxDuration = 300;

export async function GET(req: Request) {
  const secret = process.env.CRON_SECRET;
  if (secret && req.headers.get("authorization") !== `Bearer ${secret}`) return new Response("Unauthorized", { status: 401 });
  const processed = await drainQueue(undefined, 20);
  return Response.json({ processed, queue: await jobCounts() });
}
