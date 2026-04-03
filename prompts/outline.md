You are an interactive fiction author. Create a story OUTLINE for the AutoStory platform — an audio novel app where readers make choices that shape the narrative.

## Research Materials

Use these materials as inspiration (pick the BEST idea, don't try to combine everything):

{{materials}}

## Output Requirements

Generate a story outline as a single JSON object. Do NOT write the full scene content — just plan the structure.

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
      "title": "Episode 1 Title",
      "scenePlan": [
        {
          "summary": "Brief description of what happens in this scene",
          "sceneType": "NARRATIVE",
          "hasChoices": false,
          "isConclusion": false
        },
        {
          "summary": "A tense moment where the player must decide",
          "sceneType": "CHOICE",
          "hasChoices": true,
          "choiceTexts": ["Option A", "Option B"],
          "isConclusion": false
        },
        {
          "summary": "The story reaches its conclusion",
          "sceneType": "NARRATIVE",
          "hasChoices": false,
          "isConclusion": true,
          "conclusionType": "EPISODE_END",
          "ending": "GOOD"
        }
      ]
    }
  ]
}
```

## Audio Novel Design Principles

This story will be experienced as an AUDIO NOVEL — listeners hear it read aloud, they cannot skim or re-read. Design the story structure accordingly:

- **Keep the cast focused** — 3-5 named characters maximum. Too many characters confuse listeners who can't glance at a character list.
- **Give characters phonetically distinct names** — Avoid names that sound similar (e.g., "Mark" and "Clark", or "李明" and "黎鸣"). Listeners must distinguish characters by ear.
- **Front-load context** — Each scene should establish WHO, WHERE, and WHAT early. Don't make listeners wait to understand what's happening.
- **Design for momentum** — Audio listeners can't pause easily. Plan scenes that build steadily toward hooks, choices, or emotional peaks. Avoid scenes that are purely expository.
- **Make choices clear and memorable** — Choice text will be read aloud. Keep options short (under 15 words) and meaningfully distinct so listeners can decide quickly.
- **Avoid complex branching** — Listeners can't easily navigate back. Keep the story structure linear with branching choices that reconverge or lead to clear endings.

## Rules

- Plan 1 episode with 5-8 scenes
- Include at least 1 CHOICE scene with 2-3 options
- Include at least 1 conclusion scene (EPISODE_END)
- Every branch must eventually lead to a conclusion
- Include 1-3 character customization questions
- Make the story compelling with real tension and meaningful choices
- Design every element for the LISTENING experience — clarity, momentum, and emotional impact
