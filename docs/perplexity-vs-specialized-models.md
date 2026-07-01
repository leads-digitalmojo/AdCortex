# AdPilot AI Model Stack — Recommended Setup

## The Plan

| Task | Model | Provider | Cost |
|---|---|---|---|
| Static ad image generation | DALL-E 3 | OpenAI | $0.04–$0.08/image |
| Ad copy, hooks, headlines | GPT-4o | OpenAI | $2.50/M input, $10/M output |
| Campaign actions (Mojo terminal) | llama-3.3-70b | Groq | **Free** |
| Reasoning & strategy | o3-mini | OpenAI | $1.10/M input, $4.40/M output |
| Math & data analysis | o3-mini | OpenAI | $1.10/M input, $4.40/M output |
| Competitor research (live web) | sonar-large | Perplexity | $1/M tokens + $5/1K requests |

---

## 1. Creatives — GPT (OpenAI)

### Static Image Generation → DALL-E 3

DALL-E 3 is OpenAI's image model, available via the same API key as GPT-4o.

| Quality | Size | Cost per image |
|---|---|---|
| Standard | 1024×1024 | $0.040 |
| Standard | 1024×1792 (portrait/story) | $0.080 |
| HD | 1024×1024 | $0.080 |
| HD | 1024×1792 | $0.120 |

**Best for:** Product ads, offer banners, text-on-image ads, clean brand visuals.

**Workflow:**
1. GPT-4o reads your SOP + campaign brief → writes a detailed image prompt
2. DALL-E 3 generates the static ad image from that prompt
3. Repeat for variants (different sizes, CTAs, colour schemes)

### Ad Copy → GPT-4o

- Strong at following brand SOPs and creative briefs
- Good at writing multiple hook variations in one shot
- Reliable for Indian market English and Hinglish copy

| Model | Input | Output |
|---|---|---|
| `gpt-4o` | $2.50/M tokens | $10.00/M tokens |
| `gpt-4o-mini` | $0.15/M tokens | $0.60/M tokens |

> Use `gpt-4o-mini` for bulk copy drafts (50+ variations), `gpt-4o` for final high-quality versions.

---

## 2. Campaign Actions (Mojo Terminal) — Groq

**Keep Groq. It is free and fast enough for structured JSON output.**

- Model: `llama-3.3-70b-versatile`
- Free tier: 14,400 requests/day
- Response time: < 1 second (LPU hardware)
- Cost: $0

Groq does not need to be creative or reason deeply — it just needs to parse a command and return a valid JSON action plan. Llama 3.3 70B handles this well.

---

## 3. Reasoning & Strategy — OpenAI o3-mini

When someone asks "Why is my CPL high?" or "What strategy should I run for Diwali?" — that requires genuine multi-step reasoning, not just fast text generation.

**OpenAI o3-mini** is the best value reasoning model available today:

- Trained specifically for deep chain-of-thought reasoning
- Significantly outperforms GPT-4o on complex analysis tasks
- Much cheaper than o1 or o3 full
- Great for: campaign strategy, budget allocation logic, audience analysis, A/B test interpretation

| Model | Input | Output | Best For |
|---|---|---|---|
| `o3-mini` | $1.10/M | $4.40/M | Reasoning, strategy, analysis |
| `o1-mini` | $1.10/M | $4.40/M | Older, use o3-mini instead |
| `o3` (full) | $10/M | $40/M | Only if o3-mini isn't good enough |

---

## 4. Math & Data Analysis — OpenAI o3-mini

o3-mini also tops math benchmarks (AIME, MATH-500) by a wide margin over GPT-4o and all Llama variants.

**Use cases in AdPilot:**
- "What is my blended CPL across all campaigns this month?"
- "If I increase budget by 20% on my top 3 campaigns, what is projected spend?"
- "Which campaigns have the best ROAS given these targets?"
- Analysing CSV exports, computing statistical trends

**Perplexity sonar-reasoning is NOT a reasoning model** — it is Llama 70B with chain-of-thought prompting bolted on. o3-mini was purpose-built for reasoning and math from the ground up.

---

## 5. When to Use Perplexity (Only One Case)

Perplexity is only worth using when you need **live internet data**:

- "What are competitors running for Holi ads this year?"
- "What is the current CPM benchmark for real estate ads in India?"
- "What are trending hooks in the D2C skincare space right now?"

For everything else — creatives, copy, reasoning, math, campaign actions — the stack above beats it at equal or lower cost.

---

## Full Cost Breakdown

### Per-request cost estimates

| Task | Model | Tokens/request | Cost per request |
|---|---|---|---|
| Generate image prompt | GPT-4o | ~800 in, ~300 out | ~$0.005 |
| Generate static image | DALL-E 3 standard | 1 image | $0.040 |
| Write 5 ad hooks | GPT-4o | ~600 in, ~400 out | ~$0.006 |
| Mojo campaign action | Groq llama-3.3-70b | ~1500 in, ~500 out | **$0.000** |
| Campaign strategy question | o3-mini | ~1000 in, ~600 out | ~$0.004 |
| Math / data analysis | o3-mini | ~1500 in, ~800 out | ~$0.005 |
| Competitor research | Perplexity sonar-large | ~1000 in, ~500 out | ~$0.007 + search fee |

---

### Monthly cost estimate (realistic AdPilot usage)

| Activity | Volume/day | Cost/day | Monthly |
|---|---|---|---|
| Static ad images (DALL-E 3 standard) | 30 images | $1.20 | **~$36** |
| Ad copy generation (GPT-4o) | 20 requests | $0.12 | **~$3.60** |
| Mojo terminal commands (Groq) | 100 requests | $0.00 | **$0** |
| Reasoning / strategy (o3-mini) | 10 requests | $0.04 | **~$1.20** |
| Math / analysis (o3-mini) | 10 requests | $0.04 | **~$1.20** |
| Competitor research (Perplexity) | 5 requests | $0.06 | **~$1.80** |
| **TOTAL** | | **~$1.46/day** | **~$44/month** |

---

## Summary

```
Ad Image Generation
    └── DALL-E 3 (OpenAI) — $0.04/image

Ad Copy & Hooks
    └── GPT-4o (OpenAI) — $2.50/M input tokens

Campaign Actions (Mojo Terminal)
    └── Groq llama-3.3-70b — FREE

Reasoning & Strategy
    └── o3-mini (OpenAI) — $1.10/M input tokens

Math & Data Analysis
    └── o3-mini (OpenAI) — $1.10/M input tokens

Live Competitor/Market Research
    └── Perplexity sonar-large — only when web search needed
```

**One OpenAI API key covers DALL-E 3 + GPT-4o + o3-mini.**
Total estimated cost: ~$44/month for a full active AdPilot deployment.
