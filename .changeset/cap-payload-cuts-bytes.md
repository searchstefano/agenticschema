---
'@agenticschema/core': patch
---

Cut oversized payloads by bytes, and stop cutting code points in half.

`capPayload` trimmed one UTF-16 code unit at a time and re-encoded the whole candidate to measure
it, so it walked the payload once per character dropped. Multi-byte text overshoots the byte
budget two to four times over, which meant tens of thousands of laps across a 32k string on every
tool call, on content the page chose. At the default 32000-byte cap, a 200,000-character payload:

| content | before | after |
| --- | --- | --- |
| ASCII `x` | 0.2ms | 0.11ms |
| CJK `中` | 420ms | 0.31ms |
| emoji U+1F600 | 694ms | 0.85ms |

The text is now encoded once and the byte array is cut at the budget, stepping back over any
UTF-8 continuation byte to the start of the code point — at most three moves.

That also fixes a bug the old loop had. It measured in bytes but cut in UTF-16 units, so whenever
the budget fell between the halves of a surrogate pair it stopped on the stranded half, and the
model got a payload ending in a broken character. The comment above it claimed the opposite. On
200,000 random inputs mixing ASCII, accented Latin, CJK and emoji against random byte caps, the
old code stranded a surrogate 3,774 times and the new code never does. Where the old output was
well-formed the two agree exactly, so that bug is the only behaviour that changes; the cap itself
still holds, notice included.
