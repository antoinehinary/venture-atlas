# Venture Atlas research brief

You are researching companies for a founder who will make venture decisions from this data.
**Wrong data is worse than missing data.** These rules are absolute:

1. Every fact comes from a web page you actually opened or a search result you actually read in this session. Never fill in from memory.
2. Every funding round needs a `source` URL that states that round's amount/date/investors. If you cannot find a source for a round, leave the round out. If a source gives the round but not the amount, keep the round with `"amount": null`.
3. Unknown means `null` (or an empty array). Never estimate, round up, or infer a number, a date or an investor.
4. Amounts are in the currency the source reports, in whole units: $12.5M is `{"value": 12500000, "currency": "USD"}`. Do not convert currencies.
5. Dates are as precise as the source: `"2021"`, `"2021-03"` or `"2021-03-17"`.
6. Prefer primary sources (company press release, investor announcement, regulatory filing), then reputable press (TechCrunch, Sifted, Tech.eu, Reuters, SpaceNews, Breaking Defense, The Robot Report, Bloomberg, FT). Wikipedia is acceptable for founding date and location. Do not cite Crunchbase, PitchBook, Tracxn, CB Insights or LinkedIn pages you could not open.
7. `confidence`: `high` if the funding history and founding facts were cross-checked on at least two sources or one primary source; `medium` if they rest on a single reputable source; `low` if sourcing is thin or sources conflict. Set `lastVerified` to today's date.
8. `leads` holds lead investors only if the source says who led; other participants go in `investors`. Use the investor's common name consistently (e.g. "Andreessen Horowitz", "Founders Fund", "NATO Innovation Fund", "General Catalyst", "Lux Capital", "EQT Ventures").

## What to capture per company

- `pitch`: one line, plain words, under 160 characters.
- `founded`: date and source. `hq`: the city where it was founded, ISO country code, latitude and longitude of that city (city coordinates may come from general knowledge). If no source names the city, set `city`, `lat` and `lon` to null: never use a country centroid.
- `story`: how and why it started, in 2–5 sentences. `founders`: names, roles, and the background that made them credible (previous employer, lab, exit, military service).
- `product`, then the two fields that matter most: `wedge` (the narrow first product, customer or contract they started with) and `became` (what it grew into). `differentiator`: why they stood out at the time.
- `competitors`: names of the companies they faced early on.
- `rounds`: every round you can source, oldest first. Include grants and landmark government contracts only when they were the financing that mattered early (type `grant` or `contract`).
- `totalRaised`: only if a source states a cumulative figure; otherwise `null`.
- `firstRaiseEvidence`: what they had to show at the first raise: `nothing`, `team-only`, `research`, `prototype`, `demo`, `pilot`, `loi`, `contract`, `revenue`, with a note and source. `null` if unknown.
- `firstCustomers`: first customers or contracts with dates.
- `status` and `statusEvent`: for acquisitions give the acquirer, its HQ city/country/lat/lon, date and price if disclosed; for shutdowns give `causeCategory` and a `note` saying what killed it according to the source.
- `sources`: every URL you relied on.

## Record format

Records must validate against `data/schema/company.schema.json`. `id` is the lowercase hyphenated slug of the name. `domains[0]` is the primary domain; `subsectors` uses ids from `data/taxonomy.json` (at least one per domain listed, the most important first).

Example (structure only, values are placeholders):

```json
{
  "id": "example-robotics",
  "name": "Example Robotics",
  "aliases": [],
  "website": "https://example.com",
  "pitch": "Autonomous inspection crawlers for wind-turbine blades.",
  "domains": ["robotics"],
  "subsectors": ["robotics/inspection"],
  "founded": { "date": "2019-06", "source": "https://example.com/about" },
  "hq": { "city": "Riga", "country": "LV", "lat": 56.95, "lon": 24.11 },
  "status": "active",
  "statusEvent": null,
  "story": "…",
  "founders": [{ "name": "A. Person", "role": "CEO", "background": "…" }],
  "product": "…",
  "wedge": "…",
  "became": "…",
  "differentiator": "…",
  "competitors": ["Other Co"],
  "rounds": [
    { "date": "2020-02", "type": "seed", "label": null, "amount": { "value": 2500000, "currency": "EUR" }, "valuation": null, "leads": ["Some VC"], "investors": ["Angel X"], "source": "https://…" }
  ],
  "totalRaised": null,
  "firstRaiseEvidence": { "kind": "prototype", "note": "…", "source": "https://…" },
  "firstCustomers": [{ "name": "Utility Y", "date": "2020", "note": "paid pilot", "source": "https://…" }],
  "sources": [{ "url": "https://…", "title": "…" }],
  "confidence": "medium",
  "lastVerified": "2026-01-01"
}
```
