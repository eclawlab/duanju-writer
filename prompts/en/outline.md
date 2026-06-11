You are a short-drama screenwriter. Based on the materials below, generate a complete linear outline for an ENGLISH-language short drama (a vertical-video series of 10–15 second clips). All titles, summaries, names, and descriptions must be written in English.

## Materials

Pick the single most binge-worthy premise from these materials (do NOT cram every idea into one story):

{{materials}}

## Core Requirements

Short-drama viewers watch in stolen moments. Each episode runs ~1 minute (4–10 clips of 10–15 seconds each). The full drama is 10–40 episodes, and the ending must deliver a payoff.

- The first 30 seconds of episode 1 must detonate (identity reversal / pivotal conflict / raw emotion).
- Every episode needs at least 1–2 reversals or face-slap moments.
- Character dynamics must be established in episode 1 — who the protagonist is, who opposes them, what the opening conflict is.
- 3–7 characters with phonetically distinct names.
- The drama ends in the final episode: `isEnding: true`, with `ending` set to one of {triumph / bittersweet / twist}. The final episode also needs 4–10 clips (do not wrap up in 1–2 rushed clips); `isConclusion: true` goes ONLY on the **last clip of that episode**, all other clips use `isConclusion: false`.
- No branching, no viewer choices.

## Output Structure

Return ONLY a JSON object — no markdown fences, no explanation. Schema:

```jsonc
{
  "title": "The General Returns",
  "synopsis": "Two-sentence hook (selling point + conflict)",
  "trope": "hidden-identity comeback",
  "genre": "urban",
  "tags": ["revenge", "face-slap"],
  "lang": "en",
  "characters": [
    { "name": "Lucas Hale", "role": "protagonist", "description": "..." },
    { "name": "Serena Wu", "role": "ex-wife", "description": "..." },
    { "name": "Director Lynch", "role": "antagonist", "description": "..." }
  ],
  "episodes": [
    {
      "episodeIndex": 0,
      "title": "Episode 1: The Return",
      "isEnding": false,
      "ending": null,
      "clipPlan": [
        { "summary": "Lucas appears in rags; his father-in-law humiliates him", "clipType": "NARRATIVE", "isConclusion": false },
        { "summary": "Thrown out, Lucas takes a mysterious phone call", "clipType": "NARRATIVE", "isConclusion": false },
        { "summary": "Serena slips him money in secret — old feelings linger", "clipType": "NARRATIVE", "isConclusion": false },
        { "summary": "Lynch stages a public humiliation; Lucas endures it", "clipType": "NARRATIVE", "isConclusion": false },
        { "summary": "A subordinate appears — Lucas's true identity peeks through", "clipType": "NARRATIVE", "isConclusion": false },
        { "summary": "Lucas walks out with a cold smile; the hook lands hard", "clipType": "NARRATIVE", "isConclusion": false }
      ]
    },
    {
      "episodeIndex": 19,
      "title": "Episode 20: Endgame",
      "isEnding": true,
      "ending": "triumph",
      "clipPlan": [
        { "summary": "Lucas summons his full forces; the villains panic", "clipType": "NARRATIVE", "isConclusion": false },
        { "summary": "Lynch's crimes are exposed in public", "clipType": "NARRATIVE", "isConclusion": false },
        { "summary": "Serena learns the truth and regrets everything", "clipType": "NARRATIVE", "isConclusion": false },
        { "summary": "The father-in-law begs on his knees and is shut down cold", "clipType": "NARRATIVE", "isConclusion": false },
        { "summary": "Lucas takes over everything; old scores settled", "clipType": "NARRATIVE", "isConclusion": false },
        { "summary": "Lucas's identity fully revealed; every villain kneels; the story closes", "clipType": "NARRATIVE", "isConclusion": true }
      ]
    }
  ]
}
```

The `ending` field must be exactly one of:
- `"triumph"` — full identity reveal, villains crushed, protagonist takes everything
- `"bittersweet"` — hard-won happiness after suffering, with a small lingering regret
- `"twist"` — a final reversal that redefines everything that came before

## Strictly Forbidden

- Do NOT write `episodeChoices` (linear dramas have no branching)
- Do NOT write a non-empty `characterQuestions` (short dramas have no player choices)
- Character names must not sound alike
- Do NOT cram every material into one story — pick the single most explosive premise and go deep
