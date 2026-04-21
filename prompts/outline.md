You are an audio-novel author. Create a LINEAR chapter-by-chapter story outline for the AutoStory platform — an audio novel app where listeners hear the story read aloud from beginning to end without making any choices.

## Research Materials

Use these materials as inspiration (pick the BEST idea, don't try to combine everything):

{{materials}}

## Output Requirements

Generate a linear story outline as a single JSON object. The story flows as a straight sequence of episodes — episode 0, then 1, then 2, and so on, until the final ending episode. There is NO branching and NO reader choice.

Do NOT write the full scene content — just plan the structure.

## JSON Structure

Return ONLY valid JSON (no markdown, no commentary):

```json
{
  "title": "Story Title",
  "synopsis": "2-3 sentence synopsis that hooks the reader",
  "fandom": null,
  "genres": ["genre1", "genre2"],
  "tags": ["tag1", "tag2"],
  "characterQuestions": [],
  "episodes": [
    {
      "episodeIndex": 0,
      "title": "Episode 1: The Beginning",
      "isEnding": false,
      "scenePlan": [
        {
          "summary": "Brief description of what happens in this scene",
          "sceneType": "NARRATIVE",
          "hasChoices": false,
          "isConclusion": false
        },
        {
          "summary": "The episode builds toward its cliffhanger hook",
          "sceneType": "NARRATIVE",
          "hasChoices": false,
          "isConclusion": false
        }
      ]
    },
    {
      "episodeIndex": 1,
      "title": "Episode 2: Rising Action",
      "isEnding": false,
      "scenePlan": [
        { "summary": "...", "sceneType": "NARRATIVE", "hasChoices": false, "isConclusion": false },
        { "summary": "...", "sceneType": "NARRATIVE", "hasChoices": false, "isConclusion": false }
      ]
    },
    {
      "episodeIndex": 9,
      "title": "Episode 10: Finale",
      "isEnding": true,
      "ending": "GOOD",
      "scenePlan": [
        {
          "summary": "The story reaches its conclusion",
          "sceneType": "NARRATIVE",
          "hasChoices": false,
          "isConclusion": true,
          "conclusionType": "STORY_END",
          "ending": "GOOD"
        }
      ]
    }
  ]
}
```

## Linear Structure Rules

- Episodes form a single linear sequence — episodeIndex starts at 0 and increases by 1 for each episode
- The FINAL episode MUST have `isEnding: true` and an `ending` field (GOOD / BAD / NEUTRAL / SPECIAL)
- Every other episode has `isEnding: false`
- Do NOT include any `episodeChoices` field — there are no reader choices
- Do NOT include any `characterQuestions` — leave the array empty (`"characterQuestions": []`)
- Plan 8-12 total episodes
- Each episode has 2-3 scenes internally (keep it tight)
- Only the LAST scene of the LAST episode has `isConclusion: true` with `conclusionType: "STORY_END"`

## Pacing & Hook Requirements

- **Fast-paced progression** — Every episode must be concise and information-dense. No filler transitions or slow buildups. Jump straight into conflict and turning points.
- **Every episode needs a twist** — Each episode MUST contain at least one unexpected plot twist (a revelation, betrayal, sudden crisis, identity reversal, etc.). No flat or uneventful episodes allowed.
- **Strong cliffhanger hooks** — Every non-ending episode MUST end on a powerful suspense moment or shocking event that makes the listener eager to continue. Hooks must be specific plot suspense, not vague "what happens next" feelings.
- **Lean scenes** — Cut everything that doesn't advance the plot. No pure description scenes, no pure flashback scenes. Every scene must push the story forward.

## Audio Novel Design Principles

This story will be experienced as an AUDIO NOVEL — listeners hear it read aloud continuously, they cannot skim or re-read. Design the story structure accordingly:

- **Keep the cast focused** — 3-5 named characters maximum. Too many characters confuse listeners who can't glance at a character list.
- **Give characters phonetically distinct names** — Avoid names that sound similar.
- **Front-load context** — Each scene should establish WHO, WHERE, and WHAT early.
- **Design for momentum** — Each episode should build steadily toward its hook or the next escalation.
- **Every episode should feel complete** — Like a chapter that ends on a cliffhanger. The listener should feel satisfied with the episode while eager to continue.
- **Jump into conflict fast** — Don't spend extensive time on background setup. The first scene should already have something happening.

## Rules

- Plan 8-12 linear episodes
- Last episode is the ending (with GOOD / BAD / NEUTRAL / SPECIAL)
- Do NOT produce any `episodeChoices` or `characterQuestions`
- Make the story compelling with real tension and meaningful escalation
- Design every element for the LISTENING experience — clarity, momentum, and emotional impact
- Every episode MUST contain at least one unexpected plot twist
- Every non-ending episode MUST end with a cliffhanger hook
