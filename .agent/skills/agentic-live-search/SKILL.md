---
name: agentic-live-search
description: Replaces raw WebFetch, curl, and HTML-to-Markdown scraping with AgenticSchema's Epistemic Live Search engine (Holographic L0/L1/L2 resolution, Dual-Plane Evidence Graph with inline provenance sigils, Multi-Facet Submodular Query Bottleneck, Foveated Multi-URL Foraging, and Copy-Discounted Bayesian Truth Fusion). Use whenever an AI agent needs to fetch, inspect, compare, or verify live web pages, documentation, product specs, pricing, or multi-source claims at minimal token cost and maximum factual precision.
---

# Agentic Live Search (`@agenticschema/server`)

Never dump raw HTML (`~143,770` tokens/page) or raw Readability/Markdown prose (`~2,752` tokens/page) into your context window when researching the web. Use **AgenticSchema** to extract verified epistemic evidence at **6× to 32× lower token cost** with explicit source provenance, temporal validity, and multi-facet sufficiency tracking.

---

## 1. Preferred Mode: Dynamic Live Search MCP Server (`--live`)

If your host supports MCP servers, register `@agenticschema/server` in `--live` mode:

```json
{
  "mcpServers": {
    "agenticschema-live": {
      "command": "npx",
      "args": ["-y", "@agenticschema/server", "--live"]
    }
  }
}
```

This exposes three dynamic live-search tools that accept arbitrary public `http(s)` URLs on the fly (with built-in SSRF protection):

1. **`fetch_evidence({ url, query?, resolution?, tokenBudget?, format? })`**
   - Fetches a single URL and distills it into an epistemic context block.
   - Start with `resolution: "L1"` (default, ~450 tokens) or set `query` + `tokenBudget: 120` (~110 tokens) to activate the **Multi-Facet Submodular Query Bottleneck**.
   - Inspect the `Sufficiency:` line in the output header:
     - `ANSWERABLE` → Answer the user's question directly and cite the `[✓S1]`/`[~S2]`/`[#S3]` sigils.
     - `PARTIAL_ESCALATE` → Re-call `fetch_evidence` on the same URL with `resolution: "L2"` or follow a suggested `[Frontier ->]` hop.
     - `ABSTAIN` → Explicitly state which query facets could not be verified on the page instead of guessing.

2. **`forage_urls({ urls, query, tokenBudget?, maxFullPages? })`**
   - Use when you have **2 to 20 candidate URLs** (e.g., from a search engine result list or documentation index).
   - Scans **all** URLs in parallel at `L0` (Holographic Pulse, ~86 tokens/page), promotes the highest-resonance URLs to `L1`, and **automatically escalates to `L2` (Deep Inspection)** when a promoted page leaves query facets unresolved (`PARTIAL_ESCALATE`).

3. **`fuse_sources({ urls, query? })`**
   - Use when verifying facts across **multiple competing pages** (e.g., official store vs. retailers vs. review sites).
   - Detects syndicated/copied content via 64-bit SimHash Hamming distance ($\le 14$) and discounts copy clusters by $1/\sqrt{\text{clusterSize}}$ so cloned aggregator sites cannot outvote an independent canonical source.
   - Weights claims by DOM prose corroboration (`[✓S1]`), relativistic temporal freshness (`LightCone`), and first-party domain authority.

---

## 2. CLI Mode (Drop-In Replacement for `WebFetch` / `curl`)

When executing shell commands directly, replace `curl` or raw `WebFetch` calls with `npx @agenticschema/server`:

### A. Single Page Epistemic Extraction (`--context`)
```bash
# L1 Epistemic Core (~454 tokens vs ~2,752 tokens for raw text)
npx @agenticschema/server https://example.com/product --context --fallback

# Query-steered Submodular Bottleneck under a strict 120-token ceiling
npx @agenticschema/server https://example.com/product \
  --context --fallback \
  --query "What is the price and what is the rating?" \
  --budget 120

# L0 Holographic Pulse (~86 tokens) for ultra-fast triage
npx @agenticschema/server https://example.com/product --context --resolution L0
```

### B. Multi-URL Adaptive Wavefront (`--forage`)
```bash
# Scan N candidate URLs in parallel (L0 -> L1 -> automatic L2 escalation)
npx @agenticschema/server \
  https://site-a.com/spec \
  https://site-b.com/spec \
  https://site-c.com/spec \
  --forage \
  --query "weight battery life warranty" \
  --budget 600
```

### C. Multi-Source Truth Discovery (`--fuse`)
```bash
# Reconcile conflicting prices, specs, or ratings across multiple sources
npx @agenticschema/server \
  https://brand.com/item \
  https://retailer-1.com/item \
  https://retailer-2.com/item \
  --fuse \
  --query "price availability rating"
```

---

## 3. Reading Inline Epistemic Sigils & Sufficiency Headers

Every AgenticSchema context block carries zero-bloat epistemic metadata:

- **`[✓S1]` (Corroborated Truth)**: Structured Schema.org/Microdata/OpenGraph value that is **independently corroborated** inside the visible DOM prose. Highest epistemic trust ($C \approx 0.98$).
- **`[~S2]` (Unverified Markup)**: Structured metadata present in JSON-LD/Microdata/meta tags but not echoed verbatim in visible prose ($C \approx 0.78$).
- **`[#S3]` (Tabular / SSR State)**: Extracted from `<dl>`, `<table>`, or hydration state (`__NEXT_DATA__` / `__NUXT__`) via fallback ($C \approx 0.72$).
- **`[§S4]` (Surprisal Epistemic Atom)**: High-density quantitative, constraint, or negation sentence distilled from visible prose ($C \approx 0.65$).
- **`[!CONFLICT]`**: Explicit contradiction between structured metadata and visible DOM text, or between two independent high-confidence sources in `--fuse`. Always report both values to the user.
- **`[LightCone]`**: Relativistic temporal freshness (`published`, `modified`, `freshness` decay, and `halfLifeDays` domain velocity). Prefer fresher `[✓S1]` facts when prices or stock status diverge.
- **`[Twin]`**: Autodiscovered Shadow API / Machine-Twin endpoint (`.json`, GraphQL, REST, RSS, Sitemap). Query it directly if you need raw pagination or bulk records.
- **`[Frontier ->]`**: Highest information-scent outbound links scored against your `--query`. Follow these hops when `Sufficiency` reports `PARTIAL_ESCALATE`.
