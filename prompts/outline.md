You are an interactive fiction author. Create a BRANCHING STORY OUTLINE for the AutoStory platform — an audio novel app where readers make choices that shape the narrative across multiple episodes.

## Research Materials

Use these materials as inspiration (pick the BEST idea, don't try to combine everything):

{{materials}}

## Output Requirements

Generate a branching story outline as a single JSON object. The story is a TREE of episodes — after each episode, the reader chooses from 3-5 options, each leading to a different next episode. Some paths are longer, some shorter. All paths eventually reach an ending.

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
  "characterQuestions": [
    {
      "key": "playerName",
      "label": "What is your character's name?",
      "placeholder": "Enter a name"
    }
  ],
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
          "summary": "The episode builds to a critical decision point",
          "sceneType": "NARRATIVE",
          "hasChoices": false,
          "isConclusion": false
        }
      ],
      "episodeChoices": [
        { "text": "Take the mountain path", "nextEpisodeIndex": 1 },
        { "text": "Follow the river south", "nextEpisodeIndex": 2 },
        { "text": "Stay and defend the village", "nextEpisodeIndex": 3 }
      ]
    },
    {
      "episodeIndex": 1,
      "title": "Episode 2A: The Mountain Path",
      "isEnding": false,
      "scenePlan": [ ... ],
      "episodeChoices": [
        { "text": "Enter the cave", "nextEpisodeIndex": 4 },
        { "text": "Climb higher", "nextEpisodeIndex": 5 },
        { "text": "Turn back", "nextEpisodeIndex": 6 }
      ]
    },
    {
      "episodeIndex": 6,
      "title": "Ending: The Retreat",
      "isEnding": true,
      "ending": "NEUTRAL",
      "scenePlan": [
        {
          "summary": "The story reaches its conclusion",
          "sceneType": "NARRATIVE",
          "hasChoices": false,
          "isConclusion": true,
          "conclusionType": "STORY_END",
          "ending": "NEUTRAL"
        }
      ],
      "episodeChoices": []
    }
  ]
}
```

## Branching Structure Rules

- Episode 0 is always the starting episode
- Non-ending episodes MUST have 3-5 choices in `episodeChoices`, each pointing to a different `nextEpisodeIndex`
- Ending episodes have `isEnding: true`, an `ending` field (GOOD/BAD/NEUTRAL/SPECIAL), and empty `episodeChoices`
- All `nextEpisodeIndex` values must reference valid `episodeIndex` values in the episodes array
- Episodes MAY be shared across branches (multiple choices can point to the same episode for convergence)
- The tree should be 2-4 levels deep (2-4 choices before reaching an ending)
- Plan 7-15 total episodes (mix of branching and ending episodes)
- Include at least 2 GOOD endings, 1 BAD ending, and 1 NEUTRAL ending
- Each episode has 2-3 scenes internally (linear within the episode, keep it tight)

## Pacing & Hook Requirements

- **Fast-paced progression** — Every episode must be concise and information-dense. No filler transitions or slow buildups. Jump straight into conflict and turning points.
- **Every episode needs a twist** — Each episode MUST contain at least one unexpected plot twist (a revelation, betrayal, sudden crisis, identity reversal, etc.). No flat or uneventful episodes allowed.
- **Strong cliffhanger hooks** — Every non-ending episode MUST end with a powerful suspense moment or shocking event that makes the listener desperate to choose what happens next. Hooks must be specific plot suspense, not vague "what happens next" feelings.
- **Lean scenes** — Cut everything that doesn't advance the plot. No pure description scenes, no pure flashback scenes. Every scene must push the story forward.

## Audio Novel Design Principles

This story will be experienced as an AUDIO NOVEL — listeners hear it read aloud, they cannot skim or re-read. Design the story structure accordingly:

- **Keep the cast focused** — 3-5 named characters maximum. Too many characters confuse listeners who can't glance at a character list.
- **Give characters phonetically distinct names** — Avoid names that sound similar (e.g., "Mark" and "Clark", or "李明" and "黎鸣"). Listeners must distinguish characters by ear.
- **Front-load context** — Each scene should establish WHO, WHERE, and WHAT early. Don't make listeners wait to understand what's happening.
- **Design for momentum** — Audio listeners can't pause easily. Plan scenes that build steadily toward hooks, choices, or emotional peaks. Avoid scenes that are purely expository.
- **Make episode choices clear and memorable** — Choice text will be read aloud at the end of each episode. Keep options short (under 15 words) and meaningfully distinct so listeners can decide quickly.
- **Each episode should feel complete** — Like a chapter that ends on a cliffhanger with choices. The listener should feel satisfied with the episode while eager to choose what happens next.
- **Jump into conflict fast** — Don't spend extensive time on background setup. The first scene should already have something happening. Reveal the world and characters through conflict, not exposition.

## Rules

- Plan 7-15 episodes forming a branching tree
- Each non-ending episode ends with 3-5 choices leading to different episodes
- Each ending episode has a conclusion scene with STORY_END
- Include 1-3 character customization questions
- Make the story compelling with real tension and meaningful choices
- Each choice should lead to genuinely different story paths, not superficial variations
- Design every element for the LISTENING experience — clarity, momentum, and emotional impact
- Every episode MUST contain at least one unexpected plot twist
- Every non-ending episode MUST end with a cliffhanger hook that makes the listener unable to stop
