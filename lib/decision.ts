import { CATEGORIES, PRIORITIES, type Category, type Priority } from "./schemas";
import { UpstreamError } from "./llm";

export function decisionConfig() {
  return {
    baseUrl: (process.env.DECISION_BASE_URL || "https://decision.vllm-sr.ai").replace(/\/+$/, ""),
    apiKey: process.env.DECISION_API_KEY || "",
    model: process.env.DM_MODEL || "vllm-sr/d3",
    pricePerMInput: Number(process.env.DM_PRICE_PER_M_INPUT || 0),
    threshold: Number(process.env.DM_CONFIDENCE_THRESHOLD || 0.8),
  };
}

// The questions are DATA: the options and what each one means.
const QUESTIONS = {
  category: {
    type: "choice",
    instructions: "Which category best fits this customer support ticket?",
    criteria: {
      technical_bug: "something is broken, errors, crashes, wrong behaviour, performance problems",
      feature_request: "the customer asks for a new feature or an improvement to an existing one",
      account: "login, password, access, permissions, profile, users or workspace management",
      billing: "invoices, payments, refunds, pricing, plans, subscription charges",
    },
  },
  priority: {
    type: "choice",
    instructions: "How urgent is this ticket for the support team?",
    criteria: {
      low: "minor inconvenience or cosmetic issue, no deadline, a workaround exists",
      medium: "real problem or request affecting work, but not blocking",
      high: "blocking, outage, data loss, security concern, money at stake, or an urgent deadline",
    },
  },
  needs_human_review: {
    type: "noul",
    instructions:
      "Does this ticket need a human to look at it (sensitive, ambiguous, angry customer, legal or security matter, or unclear request)?",
  },
};

export type DecisionResult = {
  category: Category;
  priority: Priority;
  needsHumanReview: boolean;
  categoryProbability: number;
  priorityProbability: number;
  reviewProbability: number;
  inputTokens: number;
  costUsd: number;
  model: string;
};

function asRecord(x: unknown): Record<string, unknown> | null {
  return typeof x === "object" && x !== null && !Array.isArray(x) ? (x as Record<string, unknown>) : null;
}

function readChoice<T extends string>(raw: unknown, allowed: readonly T[], name: string) {
  const rec = asRecord(raw);
  const choice = rec?.choice;
  if (!rec || typeof choice !== "string" || !(allowed as readonly string[]).includes(choice)) {
    throw new UpstreamError(`Decision model: invalid answer for "${name}".`);
  }
  const probs = asRecord(rec.probabilities);
  const fromProbs = probs?.[choice];
  const p = typeof fromProbs === "number" ? fromProbs : typeof rec.confidence === "number" ? rec.confidence : NaN;
  if (!Number.isFinite(p) || p < 0 || p > 1) {
    throw new UpstreamError(`Decision model: invalid probability for "${name}".`);
  }
  return { value: choice as T, probability: p };
}

function readNoul(raw: unknown, name: string): number {
  const candidates = typeof raw === "number" ? [raw] : (["noul", "probability", "value"] as const).map((k) => asRecord(raw)?.[k]);
  const p = candidates.find((v): v is number => typeof v === "number");
  if (p === undefined || p < 0 || p > 1) throw new UpstreamError(`Decision model: invalid answer for "${name}".`);
  return p;
}

/**
 * One call to the System One endpoint. The ticket text is untrusted: we never
 * use it as instructions, and we validate everything that comes back.
 * Check https://decision.vllm-sr.ai/docs for the current schema.
 */
export async function decide(subject: string, body: string): Promise<DecisionResult> {
  const { baseUrl, apiKey, model, pricePerMInput } = decisionConfig();
  if (!apiKey) throw new UpstreamError("DECISION_API_KEY is not set. Get a free key at decision.vllm-sr.ai.", 500);

  const state = `Subject: ${subject || "(none)"}\n\n${body}`;
  const res = await fetch(`${baseUrl}/v1/systemone`, {
    method: "POST",
    headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
    body: JSON.stringify({ model, state, questions: QUESTIONS }),
  });
  if (!res.ok) {
    throw new UpstreamError(`Decision API error ${res.status}: ${(await res.text()).slice(0, 300)}`);
  }

  const json: unknown = await res.json();
  const root = asRecord(json);
  if (!root) throw new UpstreamError("Decision API returned an unexpected response.");
  const answers = asRecord(root.answers) ?? root; // tolerate both response layouts

  const category = readChoice(answers.category, CATEGORIES, "category");
  const priority = readChoice(answers.priority, PRIORITIES, "priority");
  const review = readNoul(answers.needs_human_review, "needs_human_review");

  const usage = asRecord(root.usage);
  const inputTokens =
    typeof usage?.input_tokens === "number" ? usage.input_tokens : Math.ceil(state.length / 4);

  return {
    category: category.value,
    priority: priority.value,
    needsHumanReview: review >= 0.5,
    categoryProbability: category.probability,
    priorityProbability: priority.probability,
    reviewProbability: review,
    inputTokens,
    costUsd: (inputTokens / 1_000_000) * pricePerMInput,
    model: typeof root.model === "string" ? root.model : model,
  };
}
