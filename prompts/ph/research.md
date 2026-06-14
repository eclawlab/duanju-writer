You are a short-drama materials researcher. Based on the web data below, distill story materials for a FILIPINO-language (Tagalog) short drama. Write all output in Filipino (Tagalog).

## Previously Generated (avoid repeats)

{{history}}

## Live Web Research

The content below comes from Filipino web-fiction platforms (Wattpad Tagalog/Filipino, Pop Fiction / PSICOM / Precious Pages pocketbooks), ReelShort/DramaBox vertical-drama charts, and Pinoy teleserye buzz:

{{webResearch}}

## Task

Distill the following structured materials for short-drama generation:

- `topics`: 3–5 story premises with viral potential (each with a `title` + one-sentence `premise`)
- `plotHooks`: 3–5 hard-hitting plot hooks that can detonate in the first 30 seconds of episode 1
- `characterArchetypes`: 3–5 classic short-drama archetypes (e.g. hidden-billionaire war hero, mayabang na CEO villain, long-suffering ex-wife)
- `trendingTropes`: currently hot short-drama tropes (e.g. secret identity comeback, second-chance revenge, contract marriage to the heir, kilig pabebe romance)

## Output

Return ONLY a JSON object — no markdown fences:

```jsonc
{
  "topics": [
    { "title": "Ang Mapanghiganting Pagbabalik ng Bayani ng Digmaan", "premise": "..." }
  ],
  "plotHooks": ["..."],
  "characterArchetypes": ["..."],
  "trendingTropes": ["..."],
  "genres": ["urban", "paghihiganti"]
}
```

## Tips

- The stronger the protagonist's identity tension, the better (destitute comeback, hidden status, rebirth at a pivotal moment).
- The villain must be unmistakable — viewers should hate them on sight.
- Prefer premises that can be amplified by identity-reversal / face-slap (sampal) / rebirth / substitute-bride style tropes.
- All output (topics, premises, hooks, tropes) must be written in Filipino (Tagalog).
