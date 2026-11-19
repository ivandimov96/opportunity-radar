/**
 * Who runs the service, for the legal pages. Nothing personal is written into
 * the code: the name and postal address come from Settings ("You, the
 * sender"), the contact address from LEGAL_EMAIL in .env or, without it, the
 * connected mailbox.
 */
import { getConfig } from "@/lib/config";
import { getSettings } from "@/lib/settings";

export const LEGAL_UPDATED = "19 November 2026";

export async function operator(): Promise<{ name: string; address: string; email: string }> {
  const s = await getSettings().catch(() => null);
  const cfg = getConfig();
  return {
    name: process.env.LEGAL_NAME || s?.senderCompany || s?.senderName || "the operator of Opportunity Radar",
    address: process.env.LEGAL_ADDRESS || s?.postalAddress || "",
    email: process.env.LEGAL_EMAIL || cfg.mail.address || "",
  };
}
