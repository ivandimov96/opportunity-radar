/**
 * The autopilot's own pause. It is set by the safety checks (too many bounces,
 * opt-outs or failed sends) and when the operator stops a batch, and only the
 * operator lifts it. While it is set the app writes and prepares as usual but
 * sends nothing on its own; sending by hand keeps working.
 */
import { nowIso } from "@/lib/ids";
import { getState, setState } from "@/lib/settings";

export interface AutopilotPause {
  at: string;
  reason: string;
}

const KEY = "autopilot.paused";
const RESUMED_KEY = "autopilot.resumedAt";

export async function autopilotPause(): Promise<AutopilotPause | null> {
  const p = await getState<AutopilotPause | { cleared: true }>(KEY);
  return p && "reason" in p ? p : null;
}

/** Pauses sending on its own. The first reason stays: a later one does not overwrite why it stopped. */
export async function pauseAutopilot(reason: string): Promise<void> {
  if (await autopilotPause()) return;
  await setState(KEY, { at: nowIso(), reason } satisfies AutopilotPause);
}

/** Lifts the pause. The safety checks start counting from this moment, so what caused the pause does not trip them again at once. */
export async function resumeAutopilot(): Promise<void> {
  await setState(KEY, { cleared: true });
  await setState(RESUMED_KEY, { at: nowIso() });
}

export async function autopilotResumedAt(): Promise<string | null> {
  return (await getState<{ at: string }>(RESUMED_KEY))?.at ?? null;
}
