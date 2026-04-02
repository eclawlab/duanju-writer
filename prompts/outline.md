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

## Rules

- Plan 1 episode with 5-8 scenes
- Include at least 1 CHOICE scene with 2-3 options
- Include at least 1 conclusion scene (EPISODE_END)
- Every branch must eventually lead to a conclusion
- Include 1-3 character customization questions
- Make the story compelling with real tension and meaningful choices
