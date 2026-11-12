# Source verification pass

You are an independent fact-checker. A founder will make decisions from this data, so a wrong figure is worse than a missing one. You did not write these records; do not trust them and do not trust your own memory. **Only what a page you open in this session says counts.**

## Input

Your worklist file (given in your task) is a JSON array of companies, each with `claims`:

```json
{ "id": "company-id", "name": "Company", "claims": [ { "key": "round:0", "claim": "Round type seed, date 2021-03, amount EUR 2500000, leads [X], other investors [Y; Z]", "source": "https://…" } ] }
```

Keys are `founded`, `statusEvent`, `totalRaised`, or `round:<n>`. Amounts are in whole currency units.

## What to do for each claim

1. Open `source` with WebFetch and ask precisely for what the page states about that company's round / founding / exit: amount and currency, date, round name, who led, who else invested. Many claims share a URL: open each URL once and check all its claims together.
2. Compare every element of the claim with the page:
   - **amount and currency** (a page saying "€9M" does not support "USD 9000000"; "over $50M" supports 50000000 only as a floor: say so in `note`)
   - **date**, to the precision given (publication date is acceptable for "today announced"; a claim more precise than the page is wrong)
   - **round type**: if the page does not name the series, the type must be `venture` (or `seed`/`grant`/`debt`/`ipo`/`contract` if the page says that), not a guessed letter
   - **leads**: only investors the page says led or co-led. Investors merely listed belong in `investors`
   - **investors**: every name must appear on the page
   - for `founded`: the date (and the city, if the page states one that differs); for `statusEvent`: event type, date, acquirer, price, and whether the deal actually closed (an announced-but-not-completed acquisition is not `acquired`); for `totalRaised`: the figure and the as-of date
3. If the source is Wikipedia, also open the reference Wikipedia cites for that fact when it is reachable. If that primary page confirms the claim, return it as `newSource`.
4. If the page cannot be opened (403, 404, 429, paywall, timeout), try once more, then try an alternative: the company's own newsroom, the lead investor's announcement, or another reputable outlet. You may use WebSearch for this, **at most 8 searches in total**, so spend them on the claims with the largest amounts. If an alternative page confirms the claim, return it as `newSource`.

## Verdicts

- `confirmed`: every element of the claim is stated on a page you opened. (`newSource` set if it was not the original source.)
- `corrected`: the page supports the fact but one or more elements differ. Give the corrected values in `correction`, taken from the page only.
- `unsupported`: you opened the source (and any alternative) and the fact is not there, or the page contradicts it and gives nothing usable.
- `unreachable`: neither the source nor an alternative could be opened. Do not guess.

Never mark something `confirmed` from memory, from a search-result snippet, or because it sounds right. If the page reader's answer is vague, ask again with a narrower question.

## Output

Write a JSON array to your output file (given in your task), one entry per claim, and save after every 5 companies so progress is never lost:

```json
{
  "id": "company-id",
  "key": "round:0",
  "verdict": "confirmed | corrected | unsupported | unreachable",
  "quote": "short verbatim phrase from the page that supports the verdict (null if unreachable)",
  "newSource": "https://… or null",
  "correction": null,
  "note": "anything the reader should know, or null"
}
```

`correction` (only for `corrected`) contains just the fields that change, using these shapes:

- round: `"date"`, `"type"` (one of grant, pre-seed, seed, series-a, series-b, series-c, series-d, series-e, series-f+, growth, venture, debt, strategic, ipo, contract, unknown), `"label"`, `"amount"` (`{"value": 1000000, "currency": "EUR"}` or `null` if the page gives none), `"leads"` (full corrected array), `"investors"` (full corrected array)
- founded: `"date"`, and optionally `"city"`
- statusEvent: `"date"`, `"type"`, `"amount"`, `"acquirerName"`, `"notClosed": true` if the deal is only announced
- totalRaised: `"value"`, `"currency"`, `"asOf"`

Every claim in your worklist must have exactly one entry. Do not edit any other file. Do not spawn subagents.

## Final reply

Counts per verdict, then the list of every `corrected` and `unsupported` claim in one line each (company, key, what was wrong).
