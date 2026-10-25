# LLM vs Decision Model report

## 1. Decision model research

Decision models (also called "System One" models) read the input once and answer typed
questions (`choice`, `noul`, `score`) with probabilities, without generating text.

| Option | Access | Free? | Notes |
| --- | --- | --- | --- |
| **vLLM Semantic Router, Decision 3.0 free API** (`vllm-sr/d3`, d3-turbo 27B) | `POST https://decision.vllm-sr.ai/v1/systemone`, key from the site (no account) | **Yes** (rate and size limits, 64 questions per request) | **Selected** |
| OpenRouter, Jev (`typesafe/jev-1.13`) | `/api/alpha/decisions`, `/api/v1/systemone` | No (input tokens charged) | Same OpenRouter account as my LLM, but costs credits |
| inference.sh, d3-lite 0.8B | SDK / REST | No (pay per run) | Small model, extra account |
| Self-hosted d3-edge 0.6B (`decisionformer serve`) | local | Yes | Needs a GPU for good latency; seconds per request on a CPU |
| OpenAI Decisions API | `POST /v1/decisions` | No (public beta, paid) | Not free |
| Cloudflare Clef / Clef-flash, Perplexity pplx-decider | open weights | Weights are free | I would have to host them |

**Why the vLLM SR free API:** it is the only option that is hosted, free, needs no account and
uses the same `/v1/systemone` contract as the course slides. The free key is enough for a
100-ticket smoke test.

## 2. Integration strategy

Three strategies are selectable from the front end (`/triage`, `/smoke`):

- **llm**: the LLM alone (OpenRouter), prompt v1 or v2 with Zod-validated JSON output.
- **dm**: one decision-model call with three questions: `category` (choice), `priority` (choice),
  `needs_human_review` (noul). No summary is produced.
- **dm+llm**: the DM answers first. If `min(P(category), P(priority)) >= DM_CONFIDENCE_THRESHOLD`
  (default 0.8) its answer is kept; otherwise (or if the DM call fails) the LLM answers. Usage and
  cost of both calls are summed, and the run records how many tickets fell back.

Safety: ticket text is untrusted. It is only sent as data (`state` / `<ticket>` tags), and every
answer from either model is validated (Zod for the LLM, enum/probability checks for the DM) before use.

## 3. Results

Same 100 labelled tickets for every run (sample size 100), triage prompt v2, one run per strategy.
Run ids are from `/admin`.

| Strategy | Run | Model(s) | Category acc. | Priority acc. | Avg latency | Cost (USD) | Tokens | Fallbacks | Errors |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| llm | b78983da | openai/gpt-4o-mini | 91% (9 wrong) | 59% (41 wrong) | 1,439 ms | 0.0079 | 42,134 | n/a | 0 |
| dm | a13cd5f0 | vllm-sr/d3 | 94% (6 wrong) | 63% (37 wrong) | 201 ms | 0 (free API) | 43,497 | n/a | 0 |
| dm+llm (threshold 0.8) | 7b255ab9 | vllm-sr/d3 + openai/gpt-4o-mini | 93% (7 wrong) | 64% (36 wrong) | 1,134 ms | 0.0040 | 64,757 | 54 / 100 | 0 |

Extra figures computed from the `dm+llm` ticket table:

- 46 tickets were answered by the DM alone, 54 fell back to the LLM.
- Priority accuracy on the 46 DM-kept tickets: 31/46 = 67%. On the 54 fallback tickets: 33/54 = 61%.
- Category accuracy on the DM-kept tickets: 45/46 = 98%. On the fallback tickets: 48/54 = 89%.
- Of the 15 priority errors among DM-kept tickets, 13 rate the ticket higher than the label.

## 4. Analysis

**Accuracy.** The three strategies are close: 91 to 94% on category and 59 to 64% on priority.
The differences are 3 tickets on category and 5 on priority out of 100, from a single run each, so
I do not claim that one is more accurate. What the data supports is that the decision model is
at least as accurate as the LLM on this task. Priority is clearly the hard label for every
strategy, and combining the two models did not lift it: the errors are mostly the same tickets,
and most of them rate a ticket one level higher than the label (for example `medium` where the
label says `low`). Two different models failing in the same direction suggests the cause is in
the task (subjective labels, or information my prompts do not send such as plan or channel),
not in the model. I did not test that hypothesis.

**Category errors** concentrate on the boundary between `technical_bug` and `feature_request`
(and a few `account` tickets), which is ambiguous even for a human.

**Latency.** The decision model is about 7x faster than the LLM on average (201 ms vs 1,439 ms),
because it reads the input once and generates no text. `dm+llm` sits in between (1,134 ms)
because 54% of tickets pay for both calls. Averages hide the tail: one DM call took 15.7 s in the
`dm+llm` run, and a few others took 1 to 1.6 s, which looks like load on the free API. A production
use would need timeouts, and my implementation already falls back to the LLM if the DM call fails.

**Cost and tokens.** The `llm` run cost $0.0079 per 100 tickets and `dm+llm` $0.0040, about half,
which matches 54% of tickets reaching the LLM. The DM cost is $0 only because the vLLM SR API is
free; hosted decision models are priced per input token, so at this volume the cost would be
similar to gpt-4o-mini rather than free. `dm+llm` used the most tokens (64,757) because fallback
tickets are processed twice. The cost saving comes from the cheaper model path, not from fewer tokens.

**Confidence and calibration.** With a 0.8 threshold the DM kept 46% of tickets and was right on
priority for 67% of them. That is below the 80% implied by the threshold, so the confidence is
over-optimistic for priority, as early independent tests of decision models also report. For
category the threshold does separate easy from hard tickets: 98% accuracy on DM-kept tickets
against 89% on fallbacks. The LLM did not fix the hard category tickets, though: the 6 category
errors among fallbacks are the same bug/feature boundary cases the LLM gets wrong alone.

**Summaries.** The DM returns no text. A ticket answered by the DM alone has no summary, so if
the product needs a summary on every ticket, the LLM is needed anyway and `dm` or `dm+llm` alone
is not enough.

## 5. Conclusion

For classification only (category, priority, review flag), `dm` is the best trade-off here: equal
or better accuracy, about 7x lower latency and no cost on the free tier. `llm` remains necessary
for anything that must be written, such as a summary. `dm+llm` halved the LLM cost but did not
improve accuracy, and on this data a 54% fallback rate means most of the latency saving is lost.
It would make more sense with a lower threshold, or for a product where the LLM output is
required only for hard tickets. Priority accuracy around 60% for every strategy means that
priority should not be fully automated: tickets should go to human review.

Limits: one run per strategy, 100 tickets, no repeated runs, a free API whose latency varies,
and a threshold fixed at 0.8 (other thresholds were not measured).
