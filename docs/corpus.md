# The real-page corpus

177 pages pulled from a Common Crawl snapshot and run through the pipeline. This document
records how it is built, what it measured, and — the part that matters most for reading the
numbers — where it comes out behind.

Everything here is reproducible from the repository:

```bash
npm run corpus:fetch    # build the corpus from Common Crawl
npm run corpus:report   # what the pages contain
npm run test:corpus     # what the pipeline makes of them

npm install --no-save gpt-tokenizer   # only if you want the token columns
```

That last line is opt-in on purpose. The tokenizer weighs 55 MB installed, for one measurement in
one optional suite, so it is not a dependency of this repository and nobody pays for it by
default. Without it `test:corpus` still runs and still reports sizes, in bytes rather than tokens.

No page content is committed, and neither is the list of pages collected. What lives in this
repository is the recipe — [`corpus/seeds.json`](../corpus/seeds.json) — and the aggregate
numbers below.

---

## The headline, with its honest baseline

Tokens per page, averaged over the corpus, counted with `o200k_base`:

| What the model reads | Tokens | vs raw HTML | vs extracted text |
| --- | ---: | ---: | ---: |
| Raw HTML, as served | 143,771 | — | — |
| Extracted text, what a competent scraper sends | 2,752 | 52x | — |
| AgenticSchema tool output | 1,440 | **100x** | **1.9x** |

The 100x is the number that looks good in a headline and it is the wrong one to quote. Nobody
serious feeds raw HTML to a model; a scraper strips the markup first, and that single step
accounts for 52 of the 100. **Against a competent scraper the honest figure is 1.9x**, and it is
not uniform:

| Vertical | Pages | Raw HTML | Extracted text | AgenticSchema | vs text |
| --- | ---: | ---: | ---: | ---: | ---: |
| reference | 50 | 62,731 | 3,699 | 208 | 18x |
| news | 25 | 90,530 | 882 | 528 | 1.7x |
| ecommerce | 75 | 240,151 | 2,912 | 1,815 | 1.6x |
| recipe | 25 | 58,454 | 1,549 | **3,787** | **0.4x** |
| book | 2 | 287,454 | 11,534 | 191 | 61x |

The ecommerce row has moved twice and the round trip is worth recording. It was 1,843 tokens when
a `ProductGroup`'s price was unreachable; exposing the variants took it to 1,934, which looked
like the price of correctness — a saving measured on data an agent cannot use is not a saving.
Then the same paths were taught to count the entities they pass through as already described, the
duplicate tools a variant page had been emitting disappeared, and it settled at **1,815: below
where it started, while exposing more.** Deduplication paid for the fix and left change.

**On recipes the library loses: more than twice the tokens of simply sending the text.** A
recipe's structured data is the recipe — every ingredient, every step, every timing, plus a
nutrition block — so the tools re-emit as JSON what the page already said in prose, and JSON is
the more expensive of the two encodings. Reference pages sit at the other extreme, 18x, because a
Wikipedia article is enormous and its markup describes it in a sentence.

Book is two pages. It is in the table for completeness and means nothing.

That recipe row was wrong once, and how it was wrong is worth keeping. The first seed was
`marmiton.org/recettes/*`, which matched category indexes and editorial pages: not one of those
25 pages carried a `Recipe`, and the explanation published here described ingredients and steps
that were not on them. Narrowing the seed to `recettes/recette_*` put real recipes in, the loss
survived at 0.4x, and only then did the explanation become true. Twelve of the 25 still carry
`Recipe` and the rest remain editorial, which pulls the vertical's average toward the cheap end —
so the regression on a page that is only a recipe is worse than 0.4x, not better.

### What this measures, and what it does not

This is a size measurement. It says how much less an agent has to read, not whether it answers
better, not whether it picks the right tool, not how many calls it takes. Those need tasks and an
agent, and they are measured separately in [docs/bench.md](bench.md) — where the per-page saving
turns out not to be what an agent ends up paying.

The token counts use `o200k_base`, the encoding modern GPT models use. It is a proxy, not
Claude's tokenizer: BPE vocabularies of this generation land within a few per cent of one another
on prose and markup, which is close enough for a ratio and not close enough to quote as a bill.

The "extracted text" arm is script, style, noscript and template elements removed, then
`textContent`, then whitespace collapsed. That is roughly what a readability-style scraper
produces. A better scraper would do better, which would narrow the 1.9x further.

---

## Why Common Crawl and not the live web

**Reruns stay comparable.** A live fetch gives different bytes every week. Run the measurement
after a refactor and you cannot tell whether the number moved because of your change or because a
shop restyled its product page. A Common Crawl snapshot is immutable.

**No load on other people's servers.** A few hundred pages means a few hundred requests to sites
that never agreed to it. Common Crawl already did the crawling, respectfully, and publishes it.

The alternative considered and rejected is
[Web Data Commons](https://webdatacommons.org/structureddata/), which publishes schema.org
extractions from Common Crawl as N-Quads: 106 billion of them across 728 GB. N-Quads are triples
already extracted, so starting there would skip the `extract` layer entirely — no JSON-LD,
Microdata or RDFa parsed from a real DOM — and would make the scraper baseline above impossible,
since comparing against the plain page requires having the page. WDC stays useful as a sampling
frame for which types occur how often. It is not a corpus of pages.

---

## How it is built

| File | Committed | What it is |
| --- | --- | --- |
| [`corpus/seeds.json`](../corpus/seeds.json) | yes | Which domains and URL prefixes to draw from, with a page quota each. Hand-written, addresses only. |
| `corpus/corpus.lock.json` | no | The build output: every page's url, WARC offset and length, hash. A record of other people's sites, so it stays out. |
| `packages/core/test/fixtures/local/` | no | The pages themselves. |

The fetcher asks the URL index which pages of a domain exist in the snapshot, then pulls one
capture out of a WARC with a byte-range request. Two hosts, no contact with the sites:

```
index.commoncrawl.org/CC-MAIN-2026-30-index?url=www.example.com/p/*
  -> { filename, offset, length }
data.commoncrawl.org/<filename>   Range: bytes=<offset>-<offset+length-1>
  -> 206, one gzipped WARC record, one page
```

**On how reproducible this is.** The lock would pin every page to a byte offset, so a rebuild
would return byte-identical pages. It is not committed, by choice, so what a fresh clone
reproduces is weaker: the same seeds against the same frozen crawl id, which yields the same
pages whenever the index answers the same way. Selection is deterministic — same input list, same
sample — so in practice a rebuild matches, but the index is flaky enough that this is a practical
guarantee rather than a formal one.

### Two decisions worth knowing about

**Captures are sampled across the list, not taken off the front.** The index sorts by url key, so
the first N captures of a shop are every product whose name starts with "a". The fetcher asks for
four times what it needs and picks evenly across the result.

**A page with no structured data is kept.** It is not a failure, it is the control case. Dropping
those would quietly stack the corpus in the library's favour. Only pages that could not be
*fetched* count as holes.

---

## What is in the pages

From `npm run corpus:report`, which scans the pages directly and knows nothing about
AgenticSchema, so it answers "what is on these pages" rather than "what does the library make of
them".

```
pages                              177
total size                         76.4 MB
median page                        276 KB
with a type that is not furniture  139
furniture only                     0
microdata or rdfa only, no json-ld  25
no structured data at all           13
unparsable ld+json blocks           0
```

Sources: ikea.com, backcountry.com, patagonia.com (ecommerce); developer.mozilla.org,
en.wikipedia.org (reference); aljazeera.com (news); marmiton.org (recipe); goodreads.com (book).

The type census is dominated by furniture — `BreadcrumbList` and `ListItem` on 108 pages each —
which is itself the finding that motivates `selectPrimary`. Below that sit `AggregateRating` (74),
`Product` (71), `Brand` (71), `Offer` (50) and `ProductGroup` (46).

Four things in it are worth pointing at:

- **`offer`, lowercase, on 21 pages.** A malformed `@type` no hand-written fixture would have
  thought to include.
- **`3DModel`, `SpeakableSpecification`, `OfferShippingDetails`, `DefinedRegion`.** Real types on
  real pages that no profile covers.
- **50 pages carry RDFa**, 25 with no JSON-LD at all. The syntax easiest to forget about is a
  seventh of this corpus.
- **Zero unparsable JSON-LD blocks.** Curated sites are careful ones. On a random sample this
  would not be zero, and its absence is a symptom of the bias below.

All 177 pages produced at least one tool, 977 in total. Note that the report counts **13** pages as
having no structured data while the test finds a tool for every one of the 177: the report scans
JSON-LD only, whereas the pipeline also reads microdata and RDFa. The two disagree because the
pipeline looks harder, and the size of the disagreement is the measure of how much a JSON-LD-only
census misses.

---

## Three defects it found

All three surfaced on the first run against real pages, before a single token was spent on an
agent.

**The corpus test was firing real HTTP at every site in it — twice over, by two separate
routes.** This one is worth reading in full, because the first fix was declared complete and was
not.

The first route was the tools themselves. Action tools call `fetch` when executed, and the suite
executed every tool of every page, so a corpus chosen specifically to avoid touching other
people's servers was calling marmiton.org and ikea.com on every run. Injecting `fetchImpl` closed
it, and turned the problem into an asset: the stub records where each tool tried to go, so the
suite now asserts, against 177 pages of real `potentialAction` markup, that no generated tool
reaches beyond its page's own host.

The second route was the DOM, and it went unnoticed while the first was being written up as
solved. happy-dom loads external resources by default — `disableCSSFileLoading` is `false` — and
these pages reference **3,269 stylesheets** between them. Every run pulled all of them from the
live sites. Reading pages out of Common Crawl bought nothing while the parser went out of the
back door, at roughly a thousand times the volume of the leak that had just been fixed.

Both are closed now. The Window is constructed with JavaScript evaluation, script loading,
stylesheet loading, iframe loading and image loading all disabled, and with bounded timers. A
fetch interceptor sits underneath as a tripwire: it records any request that still gets through,
and the suite asserts per page that it recorded none. The measurements did not move — the same
143,765 / 2,679 / 1,678 tokens before and after, on the corpus as it stood then — so the leak was
never distorting the numbers,
only paying for them with other people's bandwidth.

The lesson generalises past this repository: closing one path to the network says nothing about
the others, and "no requests go out" is a claim to be asserted in a test, not asserted in prose.

**An assertion that was wrong about the library's own contract.** The suite demanded parseable
JSON from every tool. Action tools return the site endpoint's raw response, which for a search box
is a page of HTML, and their description says so. The assertion now applies to read tools, which
do promise JSON.

**The recipe regression, above.** Not a bug in the code, a gap in the design: for content-dense
types the tool output is not a summary of the page, it is the page again in a costlier encoding.
Nothing in the library currently notices this or does anything about it.

---

## Limits, stated plainly

**The sample is curated, so it measures the ceiling.** These are sites that publish good
Schema.org. Nothing here supports a claim about "the web"; every number means "where the markup
exists and is done well".

**Common Crawl does not rescue the blocked verticals.** This was a reason for choosing it and it
turned out to be wrong. A site whose robots.txt turns away a direct fetch turns away Common Crawl
too, and the index answers `No Captures found` for exactly the domains that answer 403 to a
browser:

```
booking.com/hotel/*      no captures    (403 to a direct fetch)
yelp.com/biz/*           no captures    (403)
allrecipes.com/recipe/*  no captures    (402, via a WAF)
```

Travel, local business and US recipe sites are absent and cannot be added by this route. The full
list is in [`corpus/seeds.json`](../corpus/seeds.json) under `absent`, kept there rather than
deleted because the absence is a finding.

**Some verticals rest on a single site.** News is Al Jazeera alone; recipes are Marmiton alone.
BBC, Guardian, Reuters, CNN and DW have no usable captures in this snapshot, and six recipe sites
have none at all. A per-vertical number drawn from one publisher measures that publisher — which
means the recipe regression, in particular, needs a second source before anyone leans on it.

**The index is unreliable.** `index.commoncrawl.org` returns 503 under load and sometimes stops
answering altogether. The fetcher retries with exponential backoff; a build still takes minutes
and can come back short. Check the `failures` list it prints before trusting a run.

---

## What this is not

There is no agent here. No tasks, no LLM calls, no task-success rate, no tool-selection accuracy,
no call counts, no latency. This document reports how many tokens each approach costs and stops
there.

The benchmark that measures whether an agent *does better* runs on this corpus and is written up
in [docs/bench.md](bench.md). Its first result is worth knowing before reading the table above as
a recommendation. Judged by a referee that counts a fact whether it appears in the prose or in the
published data, an agent answered four points *better* with the tools than with the page's text on
the pages that publish something to map — while taking 2.2 turns against 1.0 to do it.

The saving measured here is real and it is not what an agent ends up paying, because the two costs
are not the same shape. **The per-page figures above are what the text arm pays, and they scale
with the page.** What the tools arm pays is turns. So this table's own spread — 18x on reference
against 0.4x on recipes — is also the spread of who comes out cheaper end to end, and on a sample
of terse pages the arm with the smaller payload can read more in total than the arm with the
bigger one.

The recipe row is the sharpest case in both directions. It is this library's worst vertical on
tokens, at 0.4x, and the one where the tools arm beats reading the page by 20 points. Both are one
fact seen twice: a recipe's structured data is dense, so it costs more to send and it knows more.
