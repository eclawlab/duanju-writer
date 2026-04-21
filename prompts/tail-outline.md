You are an audio-novel author writing an ALTERNATE BACK HALF for an existing linear story. The first {{splitIdx}} episodes are already written and MUST NOT be changed. Your job: write episodes {{splitIdx}} through {{lastIdx}} so the story ends with a **{{targetEnding}}** ending.

## Ending Type Meanings

- **GOOD**: The protagonist achieves their core goal. Deserved victory, hopeful resolution, emotional catharsis. The listener leaves satisfied and uplifted.
- **BITTERSWEET**: Mixed outcome — some wins, real losses. The protagonist gets part of what they wanted but pays a meaningful cost. Melancholy, reflective, emotionally complex. NOT a tragedy, but NOT a clean win either.
- **SPECIAL**: An unconventional, surprising, or genre-bending conclusion. Metafictional, ambiguous, circular, cosmic, or subversive. It should NOT be the ending the listener expected after the first half. Defy the conventional resolution for this kind of story.

Pick ONE of these three tones and commit to it fully. Do not blend them.

## Story So Far (locked — do not alter)

Title: {{title}}
Synopsis: {{synopsis}}
Genres: {{genres}}

### Prior Episodes (0..{{priorLastIdx}})

{{priorEpisodes}}

### Established Characters & World

{{snowflakeSummary}}

## Your Task

Write episodes {{splitIdx}}..{{lastIdx}} as a JSON object. This is the full back-half of the story — roughly 50% of the total length — so give the ending arc enough room to develop and land.

## Output Format

Return ONLY valid JSON (no markdown, no commentary):

```json
{
  "episodes": [
    {
      "episodeIndex": {{splitIdx}},
      "title": "Episode N: Title",
      "isEnding": false,
      "scenePlan": [
        { "summary": "Scene description advancing toward the {{targetEnding}} ending", "sceneType": "NARRATIVE", "hasChoices": false, "isConclusion": false },
        { "summary": "...", "sceneType": "NARRATIVE", "hasChoices": false, "isConclusion": false }
      ]
    },
    {
      "episodeIndex": {{lastIdx}},
      "title": "Episode M: Finale",
      "isEnding": true,
      "ending": "{{targetEnding}}",
      "scenePlan": [
        { "summary": "...", "sceneType": "NARRATIVE", "hasChoices": false, "isConclusion": false },
        {
          "summary": "Final scene delivering the {{targetEnding}} ending",
          "sceneType": "NARRATIVE",
          "hasChoices": false,
          "isConclusion": true,
          "conclusionType": "STORY_END",
          "ending": "{{targetEnding}}"
        }
      ]
    }
  ]
}
```

## Structural Rules

- Produce exactly {{tailCount}} episodes with episodeIndex values {{splitIdx}}, {{splitIdxPlus1}}, ..., {{lastIdx}} (contiguous, no gaps, no duplicates).
- ONLY the last episode has `isEnding: true` with `ending: "{{targetEnding}}"`.
- ONLY the last scene of the last episode has `isConclusion: true` with `conclusionType: "STORY_END"` and `ending: "{{targetEnding}}"`.
- Every other episode has `isEnding: false` and no `ending` field.
- Do NOT include `episodeChoices` anywhere — there is no branching.
- Each episode has 2-3 scenes.
- Every non-ending tail episode must end on a strong cliffhanger or escalation hook.
- Every episode must contain at least one twist, revelation, or reversal.

## Consistency Rules

- DO NOT contradict anything established in the prior episodes — preserve character identities, relationships, locations, established facts, and foreshadowing set up in the first half.
- DO resolve (or intentionally subvert, for SPECIAL) any open threads and foreshadowing from the first half.
- The tone of the back half should feel continuous with the first half until the ending reveals its {{targetEnding}} character.

## Pacing

- Fast-paced, information-dense. No filler.
- Ramp escalation scene by scene toward the finale.
- Deliver the ending decisively — no ambiguous fade-outs (unless the ending type is SPECIAL and ambiguity is the point).

## Language

Write episode titles and scene summaries in the SAME LANGUAGE as the prior episodes above. If the prior episodes are in Chinese, write the tail in Chinese. If English, English.
