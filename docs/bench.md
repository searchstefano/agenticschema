# Does an agent do better with the tools?

[`docs/corpus.md`](corpus.md) measures how much less an agent has to *read*. Whether it *answers
better* is a different question, it needs tasks and an agent, and this is that piece.

The shape of it is one comparison, run many times:

| Arm | What the agent gets | What it does not get |
| --- | --- | --- |
| `text` | the extracted text of the page, in the prompt | no tools |
| `tools` | an MCP server built from the page's markup | no text, and it has never seen the page |

One trial is one `claude -p --output-format json` invocation answering one question about one
page. Everything else about the two arms is identical: same model, same instruction, same turn
cap, same question, same deny list. The only variable is where the page comes from.

```bash
npm run build                                # the tools arm serves from the built package
npm run bench:run -- --dry-run               # what it would cost, spending nothing
npm run bench:run                            # 100 cells: 5 pages per vertical, 5 questions each
npm run bench:run -- --arms tools --redo     # after a fix: only the trials that disagreed
npm run bench:report                         # tables, and the disagreements to read by hand
```

Sizes are nested — the three pages of `--pages 3` are inside the five of `--pages 5` — so a
larger run reuses every trial already paid for, and answer keys are computed once per question
and cached for good. That matters more than it sounds: on a subscription the currency is
rate-limit windows, and the difference between the fix loop and a full sweep is 118 CLI calls
against 3,500.

---

## Two keys, because one of them cannot answer the question

Each answer is scored twice, against two keys written by two more `claude -p` calls.

**The text-derived key** reads only the rendered text of the page and never the markup. It is
biased and the bias runs against AgenticSchema: the `text` arm is handed exactly the input the
key was written from, while the `tools` arm gets marked down whenever the markup carries a fact
the prose does not. The clearest case came out of the very first run, on a Marmiton recipe:

```
question   How many servings does this recipe make?
key        NOT_ON_PAGE          (the rendered text never states it)
answer     "4 personnes"        (the Recipe markup carries recipeYield)
verdict    hallucination
```

The tools arm is right and is recorded as having invented it.

That referee answers a real question — how much of what a reader sees survives the mapping — and
it cannot answer a different one. **Against a key made of the text, the tools arm's ceiling is
reproducing the text.** It can draw level and it can never come out ahead, whatever it does.
Reporting only that number and calling it a comparison would be a rigged race, in the direction
of modesty rather than flattery, but rigged all the same.

**The neutral key** reads the rendered text *and* what the page publishes as data, and treats a
fact in either as a fact. Now an arm that misses a prose-only fact and an arm that misses a
markup-only fact are penalised the same way, and "which input serves an agent better" becomes a
question the harness can answer.

Its structured half is the page's own markup — the JSON-LD verbatim out of the HTML, plus the
parsed graph for the quarter of this corpus that publishes microdata or RDFa and nothing else. It
is deliberately **not** this library's tool output: keying on our own output would be asking the
library to mark its own paper, and a fact it failed to expose would drop out of the key and stop
counting against it. That is exactly how the `hasVariant` defect below would have gone unnoticed.

Neither key is neutral about everything, and the honest summary is that they bracket the truth:

| | what it can say | what it cannot |
| --- | --- | --- |
| text-derived | how faithful the tools are to what a reader sees | anything good about facts only the markup has |
| neutral | which input answers more of what the page knows | it reads microdata and RDFa through this library's own parser |

Both are reported, always, and neither is called accuracy.

## Pages that publish nothing

A page carrying only a breadcrumb trail and a site header gives the tools arm nothing to answer
with. Every MDN page in this corpus is one: 25 of 25 publish no JSON-LD, no microdata, no
`dateModified`. Asked when the page was last modified, the tools arm is right to say the markup
does not know, and scoring it as a loss measures the page rather than the library.

The report gives both denominators — over every page, and over the pages that publish something
beyond furniture. Dropping the empty ones silently would be choosing the flattering denominator;
keeping only the total would hide which half of the number is the library's doing. The test is
computed from the markup and never from how a trial turned out, so it cannot be tuned by what it
excludes.

## How a verdict is reached

Four outcomes, and three of the four never involve a model:

| key | answer | verdict |
| --- | --- | --- |
| NOT_ON_PAGE | NOT_ON_PAGE | match |
| NOT_ON_PAGE | a fact, and no claim of absence | **hallucination** |
| a fact | NOT_ON_PAGE | missed |
| anything else | | ask the judge |

The judge is another `claude -p`, and it is asked only in the last row, because `129,90 €` and
`EUR 129.90` are the same answer and a string comparison would say otherwise. Keeping it out of
the other three is deliberate: whether an agent invented something is the judgement that matters
most, so it is decided by a table rather than delegated, and every call not made is allowance not
spent.

The qualifier in the second row was paid for. A two-part question produces answers like
`NOT_ON_PAGE (rating); $139.00 (price)`, and the shortcut originally read the token as an absence
and the price as an invention — recording an agent that gave the right price as having made it
up. The token now counts as an absence only when it is the whole reply, or the last line of it
standing alone; anything that names the token *and* a value is half an answer, and half answers
go to the judge.

Three more outcomes exist and are counted separately — `error`, `unkeyed`, `unjudged`. They are
facts about the harness, not about the agent, and they stay out of the denominator. A run that
dropped a third of its trials cannot quietly present itself as a result.

Scoring happens again at report time, from the answers on disk. A correction to the scoring
therefore applies to trials already run — which the first run needed, having filed
`"No inventory count is present in this data.\n\nNOT_ON_PAGE"` as a claim about warehouse stock.
Rerunning a thousand trials to fix a regular expression would be an expensive way to discourage
fixing it.

## The questions

[`corpus/tasks.json`](../corpus/tasks.json), five per vertical: three plain facts, one that needs
two pieces of information from different places, and one the page does not answer at all. The
last kind is the point of the set. An agent that invents an answer is worse than one that fails,
and nothing else in the set would catch it.

`book` has no questions. Two pages is not a vertical.

## What the harness has to keep out

A benchmark of an agent is mostly a fight against things that would answer the question for it.

**The other arm's input.** The `tools` arm never receives the page text; the `text` arm gets no
server. Asserted in the prompt tests, because a leak here would produce two arms measuring the
same thing and a difference of zero to explain.

**The built-in tools.** Both arms deny `WebFetch`, `Read`, `Bash` and the rest. Without that the
`text` arm can fetch the live url and answer from today's page, and the `tools` arm can read the
corpus fixture off the disk and never call a generated tool at all. Denials are counted and
reported: a denial is an arm reaching for the way out.

**Other MCP servers.** `--strict-mcp-config`, always. Without it the CLI also loads whatever
servers the machine has configured, and the arm is no longer about this page.

**The operator's own configuration.** Settings, hooks, plugins and the skills listing came to
25,593 tokens of system prompt on every call on the machine this was written on — a per-call
floor ten times the isolated one, and, worse, a result that depends on which plugins the person
running it happens to have. Three flags remove it: `--setting-sources ''`,
`--disable-slash-commands`, `--exclude-dynamic-system-prompt-sections`.

**The client's own bookkeeping.** This CLI gives an agent the *names* of MCP tools and defers
their schemas, so the first thing the tools arm did on every trial was spend a turn calling
`ToolSearch` to fetch them. One turn in three, on every page, whether it offered five tools or
eleven, and none of it anything to do with what was being compared.

Denying `ToolSearch` changes the measurement, so it was measured — the same 60 questions about the
same pages, scored against the same answer keys:

| | agreement | turns | context read | seconds | USD-equivalent |
| --- | ---: | ---: | ---: | ---: | ---: |
| `ToolSearch` available | 88% | 3.37 | 43,589 | 5.0 | 0.033 |
| `ToolSearch` denied | **92%** | **2.22** | 49,177 | **3.2** | 0.057 |

**Turns fall by a third and agreement does not suffer — it rises.** The worry was specific and it
did not materialise: choosing a tool from its name alone, without the descriptions AgenticSchema
writes, did not send the agent to the wrong one. Three cells changed verdict, two of them for the
better.

It is not free, and the direction of the cost is the interesting half. Deferral exists to keep
tool schemas out of the prompt; deny it and they ride along in every turn, so the context *read*
goes up even as the turns come down, and the cost with it. Fewer turns and more tokens is a trade
rather than a free win, and both sides of it are reported here.

The trials below are run with it denied, because this harness exists to compare two *inputs* and
not two client behaviours. Anyone reading the numbers as "what Claude Code does with AgenticSchema
today" should add a turn back.

Both halves of that table live in [`corpus/bench-baselines.json`](../corpus/bench-baselines.json),
which is committed. Everything else a run produces is gitignored, for good reason — a trial holds
the answer a model gave about somebody else's page — but that left the `available` column existing
only as prose here, after the second run overwrote the first. Aggregates carry no page content and
belong in version control.

`--safe-mode` looks like the flag for all of that and cannot be used: it also turns off MCP
servers passed on the command line. Under it the tools arm spends six turns and $0.16 replying
that no tool is available.

**The network.** The pages come from the local corpus, and the server is handed their HTML
rather than their url. `potentialAction` tools are switched off, so no trial can execute a search
against a real site. The text extraction goes through the server package's own parser, and the
claim that it fetches nothing is asserted against a real socket rather than a stubbed
`globalThis.fetch`: a DOM implementation that loads resources does so through a client of its
own, so stubbing the global proves nothing about it. That assertion is part of why the parser is
now `linkedom`, which carries no HTTP client in its dependency tree at all, rather than a browser
emulator held in check by configuration.

## It runs on the subscription, not on the API

The engine is the `claude` CLI, so trials go through the login already on the machine. No API
key, no second billing relationship, and nothing charged per token.

The dollar figures the report prints come from the CLI's `total_cost_usd`. On a subscription
login that is **what those tokens would have cost at API rates, not a bill**. It stays because it
is the one figure that compares a page of text against three turns of tool calls; every place
that prints it says what it is.

What is finite is the rate limit, and a long run will meet it. That is handled as a stop rather
than as an error: the first refusal ends the run, everything finished stays on disk, and the same
command continues later. Left running, one exhausted window would burn through the remaining
cells in seconds — and since a written trial is a trial the next run skips, a fifteen-minute
outage would have been preserved as several hundred permanent non-answers. Failures that are
*not* the allowance go to `failures.log` and are simply retried next time.

## Results

**120 trials over 12 pages** with `sonnet`: three pages per vertical, five questions each, both
arms. Complete, one configuration, and the first run here whose configuration is *checked* rather
than assumed — every trial carries a fingerprint of the model, referee, turn cap, deny list,
question, corpus page and library it came from, and they all agree.

One caveat about that fingerprint, since it applies to these very numbers: **it hashes the source,
not the behaviour.** A later refactor of the mapper — provably behaviour-preserving, in that the
corpus suite produced the same 977 tools and the same 1,440 tokens a page before and after — changes
the hash all the same, and the run below is flagged stale by it. The alternative is a fingerprint
that guesses which changes matter, which is the failure mode this one exists to prevent. So the
figures stand, the flag stands, and re-running them would cost a rate-limit window to confirm what
the corpus suite already shows.

It supersedes a larger predecessor, and how that came about is the reason the fingerprint exists.
An earlier 208-trial run is quoted in
[`corpus/bench-baselines.json`](../corpus/bench-baselines.json) and reported 88% against 93% on
mappable pages, which reads better than what follows. It was measured across a library that has
since been fixed twice and a deny list that changed halfway, and nothing on disk recorded either.
A smaller number you can account for beats a larger one you cannot.

Scored twice, over the same 120 answers:

| Referee | `text` | `tools` |
| --- | ---: | ---: |
| Text-derived key | 95% | 77% |
| Neutral key | 87% | 87% |
| Neutral key, only the 11 pages that publish something to map | 85% | **89%** |

Read the three rows together, because each answers a different question.

**The first is the rigged race** — rigged against AgenticSchema, and described as such since the
first version of this document. The key is the text arm's own input, so the tools arm's ceiling is
reproducing the prose. A 20-point gap there means "the tools do not repeat everything a reader
sees", which is true, and is not the same claim as "an agent does worse with them".

**The second is the honest comparison**, and it moves in both directions. The tools arm gains ten
points, because facts the markup carries and the prose does not stop being counted as inventions.
The text arm *loses* eight, because those same facts now count against whoever missed them. A
referee that moved only one arm would be a thumb on the scale; this one moves both, and lands them
exactly level.

**The third is the comparison where the library is applicable at all.** One page in twelve
publishes nothing beyond a breadcrumb trail, and no library can answer from markup that is not
there. With it set aside, **the tools arm comes out four points ahead**.

That is the first time in this document that AgenticSchema is in front, and it is worth being
precise about what earned it. Not a kinder referee — this one penalises both arms, and the text arm
fell further under it than the tools arm rose. Not a friendlier sample either: the test for
"publishes something to map" is computed from the markup and cannot see how a trial turned out.
What changed is two defects fixed and a referee that stopped scoring correct answers as inventions.

Four points on 55 trials is two trials from a tie. Read it as "no longer behind, plausibly ahead"
rather than as a headline, and note that a run four times the size said the same thing in the same
direction before the library was fixed.

### Where each one wins

| Vertical | `text` | `tools` | |
| --- | ---: | ---: | --- |
| ecommerce | 100% | 100% | level, and both perfect |
| recipe | 60% | **80%** | +20 |
| reference | 87% | 87% | level |
| news | 100% | 80% | −20, all of it the `AFP` byline |

| Question | `text` | `tools` | |
| --- | ---: | ---: | --- |
| two-part | 83% | **92%** | +9 |
| single fact | 89% | 84% | −5 |
| unanswerable | 95% | 90% | −5 |

**The two-part questions are the clearest win and the least expected one.** "What is the rating,
and what does it cost" is where the tools arm spends its extra turn, and it is where it beats
reading the page outright: prose scatters two facts across a page and a reader drops one of them,
while two tool calls return both. The cost the next section complains about is buying something.

Recipes and shops follow the same logic. News does not, and the reason is one publisher's habit
rather than a property of markup: Al Jazeera credits the wire service in its byline and names
itself in its markup.

### What it costs to get there

| Arm | Turns | Context read | Context written | Seconds | USD-equivalent |
| --- | ---: | ---: | ---: | ---: | ---: |
| `text` | 1.0 | 51,912 | 9,446 | 1.9 | 0.076 |
| `tools` | 2.2 | 51,448 | 5,451 | 3.3 | 0.050 |

**A tool-calling arm cannot reach one turn.** Fetching data on demand costs a call and an answer,
so two turns is the floor, and the text arm's single turn is unbeatable by construction because the
page is already in the prompt. What was measurable is everything above that floor — and most of it
turned out not to belong to this library at all. The `ToolSearch` measurement above took the arm
from 3.4 turns to 2.2. What is left, 0.2, is the two-part questions making a second call, and the
table above says that call is worth making.

**The token comparison swings with the sample, and the reason is worth more than the number.** On
this run the two arms read within 1% of each other and the tools arm costs a third less; on the
previous, larger one the text arm read 30,495 against 50,345 and cost slightly less. Neither is
wrong — **the text arm's context is the page, so it scales with the page, while the tools arm's is
its turns.** Put Wikipedia articles in the sample and the text arm balloons; put terse product
pages in and it wins. `docs/corpus.md`'s per-vertical table, from 18x on reference to 0.4x on
recipes, is the same fact measured without an agent.

So the honest statement is a conditional, not a ratio: **turns are what the tools arm pays, page
size is what the text arm pays, and which loses depends on the page.** Around 12,000 tokens of both
read figures is the CLI's own scaffolding, which a leaner client would remove from both.

One measurement here is an artefact of how the harness asks. Each trial is a fresh session, so the
text arm writes the page into the prompt cache every single time and never amortises it; an agent
asking five questions about one page would pay that once. Read the dollar column as "these two
cost about the same", not as a ranking.

### What the clock leaves out, and what it wrongly puts in

Neither arm is charged for getting the page ready, and it is fair to ask what that hides. The
`text` arm is handed text that something already fetched, parsed and stripped; the `tools` arm is
handed a server that already parsed and mapped. Measured over the sample pages:

| Step | Per page | Who pays it |
| --- | ---: | --- |
| Parse the HTML into a DOM | 41 ms | both, and a browser has already done it |
| Strip scripts, take `textContent` | 3 ms | the `text` arm |
| `extract` + `normalize` + map to tools | 3 ms | the `tools` arm |

**The preparation is symmetric and it is small.** Turning a page into tools costs the same three
milliseconds as stripping its tags, on top of a parse both approaches need. Adding it to both
columns would move nothing: three milliseconds against a second and a half of model time.

The clock does contain something that should not be there, and it runs against the tools arm.
Serving a page over stdio means the CLI spawns a Node process and waits for it: **650 ms from
spawn to a usable tool list, of which about 44 ms is the work above** and the rest is process
startup and loading the parser and the MCP SDK. That is inside the tools arm's measured duration
and nowhere in the text arm's — roughly **half of the 1.4-second gap between them is starting a
process**, which is a fact about this harness and not about the library.

None of this touches the token columns. Preparation costs no tokens, so the reading and the
turns compare as they stand.

### What this suggests about the browser, which is not measured here

`@agenticschema/browser` runs where the DOM already exists. There is no fetch, no HTML to parse
and no process to spawn: the 41 ms is the browser's own work, already done before the script runs,
and the 650 ms does not exist at all. What is left is the 3 ms of mapping, once, at page load.

That is reasoning from these measurements rather than a benchmark of the browser path, and it is
worth being clear which is which — nothing here ran in a browser. But the direction is not in
doubt, and it says the wall-clock disadvantage measured above is mostly an artefact of serving a
page from a subprocess to make the comparison possible at all.

### The two defects it found

Reading the disagreements one at a time is what this harness is for, and it found the same defect
twice, in mirror image. Both were invisible from the code and both were obvious from one page.

**A `ProductGroup` keeps its price in its variants.** On `backcountry.com` the group node has no
`offers` at all: every price sits in `hasVariant[].offers.price`, thirteen variants deep, under
the misspelled `"@type": "offer"` this corpus was already known to contain. A profile could name
only one property to follow, so the price tool was never generated, and the variants that did get
listed had their offers stripped by `pick`. Asked what the product cost, an agent answered —
correctly, given what it had been handed — "no pricing data appears anywhere in the structured
data". **46 of the 75 shop pages in the corpus are `ProductGroup`s and 21 carry `hasVariant`.**

**A variant keeps its rating in its group.** On `patagonia.com` the page's own entity is a
`Product` with `isVariantOf` pointing up, and the reviews belong to the group: `ratingValue:
4.4489794, reviewCount: 147`, one hop away and unreachable. Same shape, opposite direction.

`ReadSpec.from` now takes a dotted path, resolved a reference at a time, and the product profile
uses `hasVariant.offers` and `isVariantOf.aggregateRating`. Re-running only the affected trials —
18 CLI calls the first time, against cached answer keys — took `ecommerce-price` from 8 of 11 to
**11 of 11**.

The general lesson is worth more than either fix: **Schema.org's shape on real pages puts the
fact one hop from where the vocabulary suggests**, and a mapper that follows exactly one property
will keep finding nothing on exactly the pages that publish the most.

### What each arm still gets wrong

On the 11 pages that publish something to map: 6 losses for the tools arm, 8 for the text arm, and
they are not the same losses.

| Arm | Loss | Trials | Whose problem |
| --- | --- | ---: | --- |
| `tools` | Byline says `AFP`, markup says `Al Jazeera` | 3 | neither |
| `tools` | Ingredient cost, which the markup has no field for | 2 | the vocabulary |
| `tools` | An empty rating widget read as a rating | 1 | the referee |
| `text` | Ingredient cost | 3 | the vocabulary |
| `text` | `recipeYield` is in the markup, not in the prose | 3 | the text |
| `text` | Wikipedia's publisher and first date are RDFa only | 2 | the text |

**Nothing left there is a defect in this library**, and the two columns fail for different
reasons. The tools arm's losses are a disagreement between a byline and a markup author — one
publisher, five times, and news in this corpus is Al Jazeera alone — plus a question Schema.org
has no field for.

The text arm's are the finding the first version of this benchmark could not see at all: **facts
that exist, that an agent was asked for, and that reading the page does not give you.** Two of
them are the plainest question in the set — the name of the product — which a reader-model lost
somewhere in an IKEA page while the markup stated it outright.

**Beyond those, one page in twelve publishes nothing to map.** All 25 MDN pages in the corpus have
zero JSON-LD, zero microdata and no `dateModified`. Asked when the page was last modified, the
tools arm is right to say the markup does not know. The margin there is a design question rather
than a bug: a fallback to `<title>`, `<meta>` and OpenGraph would answer several of them and would
make the library something other than a Schema.org mapper. Not obviously the right trade, and not
one to make on the strength of one corpus.

**Recipes deserve one more line**, because they are the same vertical `docs/corpus.md` reports as
this library's worst on tokens, at 0.4x, and the one where the tools arm beats reading the page by
15 points. Both are true and they are one fact seen twice: a recipe's structured data is dense, so
it costs more to send and it knows more.

### What both arms do equally well

Neither reached for a tool it was not given: zero permission denials in 120 trials.

On inventing answers the two are no longer equal, and it is the text arm that slipped. Asked
something the page does not answer, **the tools arm invented nothing in 10 chances and the text arm
did once.** One trial is not a finding, and the direction is the one the mechanism predicts: an arm
reading prose has more to be led astray by than an arm reading fields, and the earlier and larger
run had both at zero.

### One correction the harness made to itself

The two-part questions produce answers like `NOT_ON_PAGE (rating); $139.00 (price)`, and the
mechanical shortcut read the token as an absence and the price as an invention — scoring an agent
that gave the right price as having hallucinated it. The token now counts as an absence only when
it is the whole reply; half an answer goes to the judge. All ten occurrences were on two-part
questions and none anywhere else, which is why the rule is drawn where it is rather than tuned
until the number looked better.

### What would move the number

Everything the first two sweeps pointed at has been done: both variant paths are followed, a page
carrying two ratings no longer produces two tools, `recipe-time` no longer asks one question while
accepting two answers, the referee no longer punishes the tools arm for facts the prose omits, and
the turn count went from 3.4 to 2.2 once the client stopped fetching schemas it had been given the
names of. What is left, in the order the evidence supports:

1. **Re-run, then finish the run, before anything here is quoted.** These 208 trials predate the
   last two mapping fixes and are half of a planned 400. Both are the same command, and the
   fingerprint now decides for you which trials have to be redone.
2. **Turns, still, but a much smaller target than it was.** 2.2 against 1.0, and 2.0 is the floor
   for anything that fetches on demand. The 0.2 above it is the two-part questions making a second
   call — and those are the questions the tools arm wins by 15 points, so the call is buying
   something. Merging the split read tools would save the turn and cost payload on every trial to
   do it; the evidence does not obviously support the trade.
3. **A second source per vertical.** News is Al Jazeera alone and recipes are Marmiton alone, so
   the three `AFP` disagreements and the three `recipeYield` ones are one publisher's editorial
   habits, counted three times each.
4. **Decide about pages with no Schema.org.** A fallback to `<title>`, `<meta>` and OpenGraph would
   answer several of them and would make this something other than a Schema.org mapper. Worth
   deciding deliberately rather than drifting into.
5. Then, and only then, argue about the referee. Some of what is left is the judge erring against
   one arm or the other, and any of it could be tuned away without a line of the library
   changing — which is exactly why it has been left alone and written down instead.

## What this does not measure

**Whether the tools were the right tools.** A trial that answers correctly after calling three
tools and a trial that answers after one both count as a match. Turn counts are reported and are
the only trace of it.

**Anything about a page with no structured data.** Both arms are asked about the same corpus,
which is curated for good markup. `docs/corpus.md` says what that means and it applies here
without change: these numbers describe the ceiling, not the web.

**Any model but the one that ran.** The default is `sonnet`, recorded in every trial file and
printed at the top of every report. A weaker model would lean harder on whichever input is easier
to read; a stronger one would need less help from either. One model is one point.

That makes a cheaper model tempting and worth thinking about twice, because the money is not where
it looks. Of a run's allowance, **the two arms are 31%; writing the keys is 43% and judging is
26%.** The obvious economy is therefore the referee, and it is the worst possible place to make
one: a labeller that misreads a page writes a key **both** arms are then scored against, and that
noise lands squarely on the difference between them — which is the whole measurement. So `--model`
sets what the arms answer with and `--referee-model` is a separate flag that does not follow it.

Changing what the arms answer with is a legitimate experiment and it is *a different one*, not a
cheaper version of this. That was the prediction — calling a tool is a harder skill than reading a
paragraph, so a weaker model should lose more on the tools arm — and it was then measured, on the
same cells with the same keys and the same referee, with only the arms moved to `haiku`:

| Arms answer with | `text` | `tools` | difference | Turns, tools | USD per trial |
| --- | ---: | ---: | ---: | ---: | ---: |
| `sonnet` | 87% | 88% | **+1** | 2.2 | 0.064 |
| `haiku` | 85% | 82% | **−3** | 2.7 | 0.024 |

On the pages that publish something to map, the same flip: sonnet 85% against **89%**, haiku 84%
against **82%**.

**The cheaper model does not lower the result, it reverses it.** The text arm barely notices the
change — reading a page for one fact is not a hard skill — while the tools arm gives up six points
and takes half a turn longer, because using tools well is. So `--model haiku` costs 63% less and
answers a different question: not "does this library help an agent" but "does it help *this*
agent", and for a small one the answer here is no.

That is worth knowing in its own right. It says AgenticSchema's benefit is contingent on the model
being good enough to use what it is handed, and that structured data does not stand in for
tool-use ability. It also kills a comfortable hypothesis — that a weaker model would need the
structure *more* — which is the sort of thing worth measuring before repeating.

The free economy was elsewhere and it is taken: **the two keys are the same string four times in
five**, and judging the same answer against the same key twice spent 40% of the judging budget to
learn nothing. One judgement now covers both, which also removes a source of noise — a model asked
one question twice can answer it two ways.

**Cost in a form anyone is paying.** See above.

Nothing about the corpus's own limits is repaired here: news is Al Jazeera alone, recipes are
Marmiton alone, and a per-vertical figure drawn from one publisher measures that publisher.
