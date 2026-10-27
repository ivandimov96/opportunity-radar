/**
 * On serverless hosts there is no long-lived worker loop, so mutations that
 * enqueue jobs ask the platform to run the queue after the response is sent.
 * Locally this is a no-op: the embedded worker picks jobs up within ~1.5s.
 */
import { after } from "next/server";
import { getConfig } from "@/lib/config";

export function kickWorker() {
  if (!getConfig().serverless) return;
  try {
    after(async () => {
      const { drainQueue } = await import("./worker");
      await drainQueue(undefined, 20);
    });
  } catch (err) {
    console.warn("[jobs] could not schedule background drain", err);
  }
}
