/**
 * One turn of the background work: jobs cut off earlier go back in the queue, the scheduler looks at what is
 * due (inboxes, follow-ups, automatic sending where a workspace switched it on), and the queue is worked
 * through. For hosts without a long-lived worker: a scheduled GitHub workflow calls it every few minutes and
 * the host's own cron once a day. On a machine with the embedded worker it is not needed.
 * The caller proves itself with CRON_SECRET; in production the address is closed until that is set.
 */
import { getConfig } from "@/lib/config";
import { jobCounts } from "@/lib/jobs/queue";
import { runTick } from "@/lib/jobs/tick";

export const dynamic = "force-dynamic";
export const maxDuration = 300;

export async function GET(req: Request) {
  const secret = process.env.CRON_SECRET?.trim();
  if (!secret && getConfig().appEnv === "production") return new Response("CRON_SECRET is not set.", { status: 503 });
  if (secret && req.headers.get("authorization") !== `Bearer ${secret}`) return new Response("Unauthorized", { status: 401 });
  const turn = await runTick();
  return Response.json({ ...turn, queue: await jobCounts("all") });
}
