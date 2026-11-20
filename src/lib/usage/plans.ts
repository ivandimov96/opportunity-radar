/**
 * Plans: what a workspace may use in a calendar month. The two things that are
 * limited are the two that cost money to do: running a search and researching
 * a business (reading its website and analysing it). Writing, reviewing and
 * sending emails are not limited by the plan (sending has its own daily limits).
 *
 * The numbers are the product's to set; prices are not here (billing comes later).
 * `null` = no limit. "owner" is the workspace of whoever runs the product: only
 * the provider budgets in the environment apply to it.
 */
export type LimitedMetric = "searches" | "research";
export type Metric = LimitedMetric | "emails" | "search_credits";

export interface Plan {
  key: string;
  label: string;
  /** Per calendar month. */
  limits: Record<LimitedMetric, number | null>;
}

export const PLANS: Record<string, Plan> = {
  owner: { key: "owner", label: "Owner", limits: { searches: null, research: null } },
  trial: { key: "trial", label: "Trial", limits: { searches: 3, research: 10 } },
  starter: { key: "starter", label: "Starter", limits: { searches: 20, research: 100 } },
  growth: { key: "growth", label: "Growth", limits: { searches: 60, research: 400 } },
  scale: { key: "scale", label: "Scale", limits: { searches: 200, research: 1500 } },
};
export const DEFAULT_PLAN = "trial";
export const planOf = (key: string | null | undefined): Plan => PLANS[key ?? ""] ?? PLANS[DEFAULT_PLAN];

/** How a metric is said to a person. */
export const METRIC_NOUN: Record<LimitedMetric, { one: string; many: string; done: string }> = {
  searches: { one: "search", many: "searches", done: "run" },
  research: { one: "researched business", many: "researched businesses", done: "researched" },
};
