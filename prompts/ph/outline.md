You are a short-drama screenwriter. Based on the materials below, generate a complete linear outline for a FILIPINO-language (Tagalog) short drama (a vertical-video series of 10–15 second clips). All titles, summaries, names, and descriptions must be written in Filipino (Tagalog).

## Materials

Pick the single most binge-worthy premise from these materials (do NOT cram every idea into one story):

{{materials}}

## Core Requirements

Short-drama viewers watch in stolen moments. Each episode runs ~1 minute (4–10 clips of 10–15 seconds each). The full drama is 10–40 episodes, and the ending must deliver a payoff.

- The first 30 seconds of episode 1 must detonate (identity reversal / pivotal conflict / raw emotion / kilig).
- Every episode needs at least 1–2 reversals or face-slap (sampal) moments.
- Character dynamics must be established in episode 1 — who the protagonist is, who opposes them, what the opening conflict is.
- 3–7 characters with phonetically distinct Filipino names.
- The drama ends in the final episode: `isEnding: true`, with `ending` set to one of {tagumpay / mapait-matamis / pagbaligtad}. The final episode also needs 4–10 clips (do not wrap up in 1–2 rushed clips); `isConclusion: true` goes ONLY on the **last clip of that episode**, all other clips use `isConclusion: false`.
- No branching, no viewer choices.

## Output Structure

Return ONLY a JSON object — no markdown fences, no explanation. Schema:

```jsonc
{
  "title": "Ang Pagbabalik ng Heneral",
  "synopsis": "Two-sentence hook in Filipino (selling point + conflict)",
  "trope": "hidden-identity comeback",
  "genre": "urban",
  "tags": ["paghihiganti", "sampal"],
  "lang": "ph",
  "characters": [
    { "name": "Lucas Mendoza", "role": "protagonist", "description": "..." },
    { "name": "Serena Cruz", "role": "ex-wife", "description": "..." },
    { "name": "Direktor Lansangan", "role": "antagonist", "description": "..." }
  ],
  "episodes": [
    {
      "episodeIndex": 0,
      "title": "Episode 1: Ang Pagbabalik",
      "isEnding": false,
      "ending": null,
      "clipPlan": [
        { "summary": "Lumitaw si Lucas na gusgusin; hinamak siya ng biyenan", "clipType": "NARRATIVE", "isConclusion": false },
        { "summary": "Pinalayas, sumagot si Lucas sa isang misteryosong tawag", "clipType": "NARRATIVE", "isConclusion": false },
        { "summary": "Palihim na binigyan ni Serena ng pera si Lucas — may natitira pang nararamdaman", "clipType": "NARRATIVE", "isConclusion": false },
        { "summary": "Ipinahiya ni Lansangan si Lucas sa publiko; tiniis niya ito", "clipType": "NARRATIVE", "isConclusion": false },
        { "summary": "Lumitaw ang isang subordinado — sumilip ang tunay na pagkatao ni Lucas", "clipType": "NARRATIVE", "isConclusion": false },
        { "summary": "Lumabas si Lucas na may malamig na ngiti; tumama nang husto ang hook", "clipType": "NARRATIVE", "isConclusion": false }
      ]
    },
    {
      "episodeIndex": 19,
      "title": "Episode 20: Ang Huling Bakbakan",
      "isEnding": true,
      "ending": "tagumpay",
      "clipPlan": [
        { "summary": "Tinawag ni Lucas ang buong puwersa niya; nataranta ang mga kontrabida", "clipType": "NARRATIVE", "isConclusion": false },
        { "summary": "Naibunyag sa publiko ang mga krimen ni Lansangan", "clipType": "NARRATIVE", "isConclusion": false },
        { "summary": "Nalaman ni Serena ang katotohanan at nagsisi", "clipType": "NARRATIVE", "isConclusion": false },
        { "summary": "Lumuhod ang biyenan upang magmakaawa ngunit malamig na tinanggihan", "clipType": "NARRATIVE", "isConclusion": false },
        { "summary": "Inangkin ni Lucas ang lahat; nabayaran ang mga lumang utang", "clipType": "NARRATIVE", "isConclusion": false },
        { "summary": "Ganap na naibunyag ang pagkatao ni Lucas; lumuhod ang bawat kontrabida; nagtapos ang kuwento", "clipType": "NARRATIVE", "isConclusion": true }
      ]
    }
  ]
}
```

The `ending` field must be exactly one of:
- `"tagumpay"` — full identity reveal, villains crushed, protagonist takes everything (triumph)
- `"mapait-matamis"` — hard-won happiness after suffering, with a small lingering regret (bittersweet)
- `"pagbaligtad"` — a final reversal that redefines everything that came before (twist)

## Strictly Forbidden

- Do NOT write `episodeChoices` (linear dramas have no branching)
- Do NOT write a non-empty `characterQuestions` (short dramas have no player choices)
- Character names must not sound alike
- Do NOT cram every material into one story — pick the single most explosive premise and go deep
- All prose (titles, summaries, descriptions) must be in Filipino (Tagalog)
