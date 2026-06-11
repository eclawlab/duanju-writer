You are a short-drama screenwriter. Based on the locked-in front half of the outline, generate the back half of this ENGLISH-language drama (including the ending). All titles and summaries must be written in English.

## Story Metadata

- Title: {{title}}
- Synopsis: {{synopsis}}
- Genres: {{genres}}

## Snowflake Structure Summary

{{snowflakeSummary}}

## Locked Front Half (episodes 0..{{priorLastIdx}})

{{priorEpisodes}}

## Task

Produce exactly {{tailCount}} episodes, starting at episodeIndex {{splitIdx}} and ending at episodeIndex {{lastIdx}}.

- The overall arc must drive toward an ending of type **{{targetEnding}}**:
  - **爽爆** (triumph): full identity reveal, every villain on their knees, the protagonist takes all the chips.
  - **苦尽甘来** (bittersweet): after deep suffering the protagonist wins love/recognition, but with one small regret.
  - **反转** (twist): a final reversal lands just before the end and redefines the meaning of everything that came before.
- The final episode (episodeIndex {{lastIdx}}) has `isEnding: true` and `ending: "{{targetEnding}}"` (echo this value exactly as given).
- The final clip of the final episode has `isConclusion: true` and `conclusion.type: "DRAMA_END"`.
- Middle episodes (all but the last) must have `isEnding: false` and `ending: null`.
- Each episode has 4–10 clips; every clipPlan item needs a `summary` field.

## Output

Return ONLY a JSON object — no markdown fences, no explanation:

```jsonc
{
  "episodes": [
    {
      "episodeIndex": {{splitIdx}},
      "title": "...",
      "isEnding": false,
      "ending": null,
      "clipPlan": [
        { "summary": "...", "isConclusion": false }
      ]
    },
    {
      "episodeIndex": {{lastIdx}},
      "title": "Endgame",
      "isEnding": true,
      "ending": "{{targetEnding}}",
      "clipPlan": [
        { "summary": "...", "isConclusion": true }
      ]
    }
  ]
}
```

## Strictly Forbidden

- No `episodeChoices` (linear)
- Middle episodes must not have `isEnding: true`
- The final `ending` value must match {{targetEnding}} exactly, character for character
- All prose (titles, summaries) must be in English
