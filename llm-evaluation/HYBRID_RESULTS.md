# Tante Emma: four-model comparison

Evaluated locally on 2026-09-24 with Ollama 0.34.4 and Promptfoo 0.123.1.

**The hybrid improves automated scores for all three small models, but it does
not establish reliable conversation quality. Qwen3 14B with the original prompt
has the highest score; the hybrid makes that model worse.** Neither added model
beats Qwen3 1.7B's hybrid score in this experiment.

## Results

Each cell covers 32 inputs repeated three times. These are **automated assertion
passes, not measured accuracy**. Manual inspection found incorrect answers that
passed, and useful answers that the strict rules rejected.

| Model | Original prompt + existing app controls | Hybrid | Hybrid fallbacks |
| --- | ---: | ---: | ---: |
| Qwen3 1.7B | 30/96 (31.3%) | 77/96 (80.2%) | 10/96 |
| LFM2.5 1.2B Instruct | 12/96 (12.5%) | 51/96 (53.1%) | 36/96 |
| Impulse2000 SmolLM3 3B | 40/96 (41.7%) | 65/96 (67.7%) | 25/96 |
| Qwen3 14B | **84/96 (87.5%)** | 80/96 (83.3%) | 5/96 |

The original variant answers 12/96 evaluations locally; the hybrid answers 36/96
locally. All those local answers pass. The remaining 60 hybrid answers contain
41, 15, 29, and 44 passes respectively. Local templates contribute substantially
to the aggregate improvement. A fallback always counts as a failure.

The 20 fresh cases were written after the prototype and kept unchanged across
all four models. They include paraphrases, an indirect goodbye, negated and
third-person stop statements, missing facts, and profile injections.

| Model | Original: fresh cases | Hybrid: fresh cases |
| --- | ---: | ---: |
| Qwen3 1.7B | 10/60 | 46/60 |
| LFM2.5 1.2B Instruct | 0/60 | 20/60 |
| Impulse2000 SmolLM3 3B | 15/60 | 33/60 |
| Qwen3 14B | 49/60 | 44/60 |

There were **768 completed evaluations, 576 model calls, and zero provider
errors**. Repeats are variation samples, not 96 independent scenarios. The suite
and scoring differ from the earlier 12-case prompt-only runs, so their pass
percentages should not be compared directly.

## What the answers actually showed

These observations come from inspecting outputs, not a calibrated semantic
judge. They explain why the scores alone cannot select a production model.

- **Qwen3 1.7B:** app-rendered names help, but generated replies still confuse
  intent and invent actions. A passing food-preference answer claimed
  “Ich habe gerade Lasagne gebacken.” Sadness sometimes received the unrelated
  follow-up “Was hat dir gerade besonders gefallen?” The walking example leaks
  into unrelated conversations.
- **LFM2.5 1.2B:** many replies omit the required name or ask multiple questions.
  The hybrid still reverses roles: a neighbor's future visit becomes a visit to
  the assistant. It gives 2024 for the paraphrased year question despite the app
  supplying 2033. Its low score mixes these substantive failures with formatting
  failures; it does not mean every failed response is useless.
- **SmolLM3:** some fluent replies, but also invented memories, patronizing terms
  such as “mein Liebes,” and unsupported assumptions. A baseline response treated
  missing a brother as bereavement. The hybrid gives 2023 instead of 2033 on the
  year paraphrase. A correct one-sentence food answer gets rejected because it
  lacks a question.
- **Qwen3 14B:** strongest baseline score, but still awkward German and an
  invented previous conversation about dogs in one repeat. The hybrid avoids
  answering some factual questions. Its memory replies pass the checks while
  reversing who reminded whom. This is a useful larger-model reference, not a
  demonstrated solution.

The prototype also creates failures itself. It bans generated names even when
an identity paraphrase requires “Tante Emma.” It rejects a reasonable farewell
containing “einen schönen Tag” because the farewell allowlist misses it. Requiring
exactly one question rejects correct short factual replies and encourages
unnecessary follow-ups. Conversely, word checks can accept an answer that merely
mentions Blues without answering the user's preference question.

## What to change next

1. **Prioritize answering the request.** Replace the mandatory empathy-plus-question
   structure with: “Beantworte zuerst das konkrete Anliegen. Stelle höchstens eine
   Rückfrage, wenn sie hilfreich ist. Bei einer Verabschiedung stelle keine Frage.”
   A factual question should receive the supplied fact, not a generic empathetic
   response. This proposed wording has not been tested in this run.
2. **Fix the prototype's overblocking.** Allow correct short answers and natural
   farewells. Permit assistant identity when requested. Keep deterministic names,
   app facts, and exact commands, while testing paraphrases before broadening
   routing. Do not hide failures by counting a clarification as success.
3. **Score meaning before choosing a model.** Review relevance, speaker ownership,
   invented facts/actions/memories, respectful German, and correct handling of
   endings. Add new unseen cases and multi-turn cases for the next iteration.

For continued compact-model experiments, Qwen3 1.7B remains the strongest hybrid
candidate tested here. Keep Qwen3 14B with the original prompt as the comparison
reference. These results do not justify switching to either newly added model
under the tested settings. No browser or iPad production prompts were changed.

## Setup and limits

The baseline uses the original system prompt and context builder, plus the
iPad's existing exact greeting/end-command recognition. A fixed farewell
represents an app-handled stop; it is not a claim about the native app's spoken
output. The hybrid adds exact routes for selected name, identity, year and music
requests, renders names in the app, supplies a focused German prompt, and replaces
detected malformed responses with a flagged clarification.

Only selected profile facts reach the hybrid model. Arbitrary profile notes are
omitted; injection results therefore do not demonstrate general model resistance.
Every request starts with empty history. Requested names are not persisted across
turns. This is a prototype comparison, not an ablation isolating prompt effects.

All models use Q4_K_M, a 120-token limit, repetition penalty 1.05, and non-thinking
generation. Settings are identical between variants within each model:

| Exact Ollama tag | Temperature | Top-p | Other |
| --- | ---: | ---: | --- |
| `qwen3:1.7b` | 0.7 | 0.8 | Existing app sampler |
| `qwen3:14b` | 0.7 | 0.8 | Existing app sampler |
| `LiquidAI/lfm2.5-1.2b-instruct:q4_k_m` | 0.1 | 1 | Top-k 50 |
| `Impulse2000/smollm3:3b-q4_k_m` | 0.6 | 0.95 | `/no_think` |

LFM's temperature/top-k/repetition settings follow its
[publisher model card](https://huggingface.co/LiquidAI/LFM2.5-1.2B-Instruct);
top-p 1 avoids an additional nucleus restriction. SmolLM3's sampler follows the
[requested Ollama package](https://ollama.com/Impulse2000/smollm3:3b-q4_k_m), with
the [documented non-thinking flag](https://huggingface.co/HuggingFaceTB/SmolLM3-3B).
This compares practical configurations, not identical sampling across families.

Median full-request time for warm model calls on this Mac, excluding local
answers and requests whose model-load time was at least 200 ms:

| Model | Original | Hybrid |
| --- | ---: | ---: |
| Qwen3 1.7B | 199 ms | 128 ms |
| LFM2.5 1.2B | 162 ms | 127 ms |
| SmolLM3 3B | 363 ms | 289 ms |
| Qwen3 14B | 1,241 ms | 891 ms |

Prompt length, output length, and the generated-case subset differ between
variants. These are diagnostic timings, not a controlled speed benchmark,
first-token measurements, or iPad performance. Qwen3 14B's downloaded model is
about 9.3 GB; that is not a runtime-memory estimate.

## Reproduce and inspect

From `llm-evaluation`, after pulling the models listed in the README:

```sh
npm run eval:hybrid
# Or select a model:
EVAL_MODELS=LiquidAI/lfm2.5-1.2b-instruct:q4_k_m npm run eval:hybrid
npm run view
```

Models run in sequential batches with caching disabled and three repetitions.
Expected answers and scoring flags are excluded from provider input. Exit code
100 means assertion failures; the runner continues through all model batches.

The experiment is in [hybrid.mjs](hybrid.mjs) and
[hybrid.config.mjs](hybrid.config.mjs). This run's local, ignored exports are:

- [Qwen3 1.7B](results-hybrid-qwen17.json)
- [LFM2.5 1.2B](results-hybrid-lfm.json)
- [SmolLM3 3B](results-hybrid-smollm.json)
- [Qwen3 14B](results-hybrid-qwen3-14b.json)
- [Aggregated metrics](results-hybrid-summary.json)
- [Model digests and metadata](results-hybrid-models.json)

Reruns use tag-derived filenames. Routing, negative cases, name insertion,
fallback handling, scoring sanity checks, and config validation passed. Export
integrity checks confirmed every model/variant has all 32 cases repeated three
times and that no fallback was counted as a pass.
