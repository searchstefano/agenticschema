---
name: agentic-live-search
description: Replaces raw WebFetch, curl, and HTML-to-Markdown scraping with AgenticSchema's Epistemic Live Search engine (Holographic L0/L1/L2 resolution, Dual-Plane Evidence Graph with 4D confidence & inline sigils, Multi-Facet Sufficiency with absence taxonomy, Active Inference EVI Controller, Foveated Multi-URL Foraging, and Claim-Level Copy-Discounted Log-Odds Bayesian Fusion). Use whenever an AI agent needs to fetch, inspect, compare, or verify live web pages, documentation, product specs, pricing, or multi-source claims at minimal token cost and maximum factual precision.
---

# Agentic Live Search (`@agenticschema/server`)

Never dump raw HTML (`143,770` tokens/page mean) or raw Readability/Markdown prose (`2,752` tokens/page mean) into your context window when researching the web. Use **AgenticSchema** to extract verified epistemic evidence at **6.7× to 28× lower token cost** (`413` tokens at `L1`, `110` tokens at `Submodular budget=120`, `99` tokens at `L0`), with explicit cross-representation consistency, temporal validity, per-facet sufficiency diagnostics, and an Expected Value of Information (EVI) controller.

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

1. **`fetch_evidence({ url, query?, resolution?, tokenBudget? })`**
   - Fetches a single URL and distills it into an epistemic context block.
   - Start with `resolution: "L1"` (default, `413` tokens mean) or set `query` + `tokenBudget: 120` (`110` tokens mean) to activate the **Multi-Facet Submodular Query Bottleneck**.
   - Inspect the `⚖️ Epistemic Sufficiency` and `🎯 Controller` lines in the output header:
     - `ANSWERABLE` / `STOP_AND_ANSWER` → Every required query facet satisfies $\text{Evidence}(f_i) \ge \tau_i$ (`SATISFIED`). Answer directly and cite the inline sigils.
     - `PARTIAL_ESCALATE` + `ESCALATE_L2` → One or more facets are `NOT_PUBLISHED` in structured markup; re-call `fetch_evidence` on the same URL with `resolution: "L2"`.
     - `PARTIAL_ESCALATE` + `QUERY_MACHINE_TWIN` or `FOLLOW_FRONTIER` → Follow the target same-origin JSON twin or high-scent frontier hop (e.g. `.pdf` datasheet).
     - `ABSTAIN` → Explicitly report which facets are `NOT_PUBLISHED`, `NOT_FOUND`, `CONFLICTED`, or `UNVERIFIABLE` instead of guessing from parametric memory.

2. **`forage_urls({ urls, query, foveaCount? })`**
   - Use when you have **2 to 10 candidate URLs** (e.g., from a search engine result list or documentation index).
   - Scans **all** URLs in parallel at `L0` (Holographic Pulse, `99` tokens/page mean), promotes the highest-resonance URLs to `L1` (`413` tokens/page mean), and **automatically escalates to `L2` (Deep Inspection)** when a promoted page leaves query facets unresolved (`PARTIAL_ESCALATE`).

3. **`fuse_sources({ urls, query?, mode? })`**
   - Use when verifying facts across **multiple competing pages** (e.g., official store vs. retailers vs. review sites).
   - Performs **Claim-Level SimHash Dependency Detection**: if a comparator copies the manufacturer's description and price (`999 EUR`) but measures weight (`2.0 kg`) independently, its price claim is discounted as a copy cluster ($1/\sqrt{k}$) while its independent weight claim retains full weight ($1.0$).
   - Computes calibrated **Log-Odds Bayesian Posteriors** $P(v \mid \mathcal{D}) \in (0, 0.99]$ weighted by cross-representation consistency (`[✓S1]`), relativistic temporal freshness (`LightCone`), and first-party domain authority.

---

## 2. CLI Mode (Drop-In Replacement for `WebFetch` / `curl`)

When executing shell commands directly, replace `curl` or raw `WebFetch` calls with `npx @agenticschema/server`:

### A. Single Page Epistemic Extraction (`--context`)
```bash
# L1 Epistemic Core (~413 tokens mean vs ~2,752 tokens for raw text)
npx @agenticschema/server https://example.com/product --context --fallback --resolution L1

# Query-steered Multi-Facet Submodular Bottleneck under a strict 120-token ceiling (~110 tokens mean)
npx @agenticschema/server https://example.com/product \
  --context --fallback \
  --query "What is the price, weight, and warranty?" \
  --budget 120

# L0 Holographic Pulse (~99 tokens mean) for ultra-fast triage
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

## 3. Reading Inline Epistemic Sigils, Absence Taxonomy & EVI Controller

Every AgenticSchema context block carries zero-bloat epistemic metadata:

### Inline Epistemic Sigils
- **`[✓✓S0]` (Cross-Origin Independent Consensus)**: Confirmed across $\ge 2$ independent (non-copied) origin clusters in `--fuse` with calibrated Bayesian posterior $P(v \mid \mathcal{D}) \ge 0.80$.
- **`[✓S1]` (Cross-Representation Consistent)**: Structured Schema.org/Microdata/RDFa datum that is **consistent with the visible DOM prose** on the same page ($C_{\text{agreement}} = 0.92$, ruling out SEO cloaking or template drift, though not a substitute for multi-origin verification).
- **`[~S2]` (Unverified Markup)**: Structured metadata present in JSON-LD/Microdata/meta tags but not echoed verbatim in visible prose ($C_{\text{agreement}} = 0.78$).
- **`[#S3]` (Tabular / SSR State)**: Extracted from `<dl>`, `<table>`, or hydration state (`__NEXT_DATA__` / `__NUXT__`) ($C_{\text{agreement}} = 0.82\text{–}0.88$).
- **`[§S4]` (Surprisal Epistemic Atom)**: High-density quantitative, constraint, or temporal proposition distilled from visible prose ($C_{\text{agreement}} = 0.70$).
- **`[!CONFLICT]`**: Explicit contradiction between structured metadata and visible DOM text, or between independent high-confidence sources in `--fuse`. Always report both values to the user.

### Per-Facet Absence Taxonomy (`facetDiagnostics`)
Never confuse the absence of a datum with its non-existence:
- **`SATISFIED`**: $\text{Evidence}(f_i) \ge \tau_i$ with zero active conflict.
- **`NOT_PUBLISHED`**: The page publishes a structured entity (e.g. `Product`), but omits this schema property from its markup/specs — escalate to `L2` prose or a `.pdf` datasheet hop.
- **`NOT_FOUND`**: Exhaustive inspection (including `L2` prose) found no trace of the facet on this page.
- **`CONFLICTED`**: Discrepancy detected across representations or sources.
- **`UNVERIFIABLE`**: Mentioned on the page, but epistemic confidence is below $\tau_i$ (e.g. `⚠️EXPIRED_OFFER` in the past light-cone).
