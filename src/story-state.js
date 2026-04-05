/**
 * Story State Tracker
 *
 * Manages entity states (characters, items, locations), revelation scheduling,
 * character-scoped context, validation, and serialization.
 *
 * All functions operate on plain objects (no classes). State is mutated in place
 * for characters/items/locations/revelations to match the project's imperative style.
 */

/**
 * Create an empty story state.
 * @returns {{ characters: {}, items: {}, locations: {}, revelations: [] }}
 */
export function createState() {
  return {
    characters: {},
    items: {},
    locations: {},
    revelations: [],
    plotArcs: [],
    relationships: [],
    foreshadowing: [],
  };
}

// ---------------------------------------------------------------------------
// Characters
// ---------------------------------------------------------------------------

/**
 * Add a character to state.characters keyed by name.
 * @param {object} state
 * @param {{ name: string, status: string, location: string, knowledge: string[], emotional: string }} char
 */
export function addCharacter(state, { name, status, location, knowledge, emotional }) {
  state.characters[name] = { name, status, location, knowledge, emotional };
}

/**
 * Merge updates into an existing character.
 * @param {object} state
 * @param {string} name
 * @param {object} updates
 */
export function updateCharacter(state, name, updates) {
  if (!state.characters[name]) throw new Error(`Character not found: ${name}`);
  state.characters[name] = { ...state.characters[name], ...updates };
}

// ---------------------------------------------------------------------------
// Items
// ---------------------------------------------------------------------------

/**
 * Add an item to state.items keyed by name.
 * @param {object} state
 * @param {{ name: string, status: string, holder: string|null, location: string|null }} item
 */
export function addItem(state, { name, status, holder, location }) {
  state.items[name] = { name, status, holder, location };
}

/**
 * Merge updates into an existing item.
 * @param {object} state
 * @param {string} name
 * @param {object} updates
 */
export function updateItem(state, name, updates) {
  if (!state.items[name]) throw new Error(`Item not found: ${name}`);
  state.items[name] = { ...state.items[name], ...updates };
}

// ---------------------------------------------------------------------------
// Locations
// ---------------------------------------------------------------------------

/**
 * Add a location to state.locations keyed by name.
 * @param {object} state
 * @param {{ name: string, status: string }} location
 */
export function addLocation(state, { name, status }) {
  state.locations[name] = { name, status };
}

/**
 * Merge updates into an existing location.
 * @param {object} state
 * @param {string} name
 * @param {object} updates
 */
export function updateLocation(state, name, updates) {
  if (!state.locations[name]) throw new Error(`Location not found: ${name}`);
  state.locations[name] = { ...state.locations[name], ...updates };
}

// ---------------------------------------------------------------------------
// Revelations
// ---------------------------------------------------------------------------

/**
 * Push a revelation onto state.revelations with revealed: false.
 * @param {object} state
 * @param {{ id: string, info: string, visibility: string, revealInScene: number, revealInEpisode?: number }} revelation
 */
export function addRevelation(state, { id, info, visibility, revealInScene, revealInEpisode }) {
  state.revelations.push({ id, info, visibility, revealInScene, revealInEpisode: revealInEpisode ?? null, revealed: false });
}

/**
 * Mark a revelation as revealed by id.
 * @param {object} state
 * @param {string} id
 */
export function markRevealed(state, id) {
  const rev = state.revelations.find(r => r.id === id);
  if (!rev) throw new Error(`Revelation not found: ${id}`);
  rev.revealed = true;
}

/**
 * Return unrevealed revelations available at a given scene index.
 *
 * Rules:
 *  - Always include `public` visibility (regardless of revealInScene).
 *  - Include `hidden` and `delayed` when revealInScene <= sceneIndex.
 *  - If `revealInEpisode` is set, only include if that episode is on the current branch.
 *  - Never include `never_explicit`.
 *  - Never include already-revealed entries.
 *
 * @param {object} state
 * @param {number} sceneIndex
 * @param {Set|null} [ancestorEpisodeIndices] - episodes on the current branch path
 * @returns {object[]}
 */
export function getAvailableRevelations(state, sceneIndex, ancestorEpisodeIndices = null) {
  return state.revelations.filter(r => {
    if (r.revealed) return false;
    if (r.visibility === 'never_explicit') return false;
    // If revelation is tied to a specific episode, only show on that branch
    if (r.revealInEpisode != null && ancestorEpisodeIndices) {
      if (!ancestorEpisodeIndices.has(r.revealInEpisode)) return false;
    }
    if (r.visibility === 'public') return true;
    if (r.visibility === 'hidden' || r.visibility === 'delayed') {
      return r.revealInScene <= sceneIndex;
    }
    return false;
  });
}

// ---------------------------------------------------------------------------
// Character-scoped context
// ---------------------------------------------------------------------------

/**
 * Return a filtered state snapshot containing only what the named character
 * can directly perceive:
 *  - The character themselves
 *  - Other characters at the same location
 *  - Items held by the character OR located at the character's location
 *  - The character's current location
 *
 * @param {object} state
 * @param {string} characterName
 * @returns {{ characters: {}, items: {}, locations: {} }}
 */
export function getCharacterContext(state, characterName) {
  const char = state.characters[characterName];
  if (!char) throw new Error(`Character not found: ${characterName}`);

  const charLocation = char.location;

  // Characters: self + co-located
  const characters = {};
  for (const [name, c] of Object.entries(state.characters)) {
    if (name === characterName || c.location === charLocation) {
      characters[name] = c;
    }
  }

  // Items: held by character OR at character's location (unheld)
  const items = {};
  for (const [name, item] of Object.entries(state.items)) {
    if (item.holder === characterName || item.location === charLocation) {
      items[name] = item;
    }
  }

  // Locations: only the character's current location
  const locations = {};
  if (charLocation && state.locations[charLocation]) {
    locations[charLocation] = state.locations[charLocation];
  }

  return { characters, items, locations };
}

// ---------------------------------------------------------------------------
// Validation
// ---------------------------------------------------------------------------

/**
 * Return an array of contradiction strings describing inconsistencies in state.
 *
 * Checks:
 *  1. Dead character holding an active item.
 *  2. Alive character at a destroyed location.
 *  3. Active item at a destroyed location (unheld).
 *
 * @param {object} state
 * @returns {string[]}
 */
export function validate(state) {
  const errors = [];

  // 1. Dead character holding active item
  for (const [charName, char] of Object.entries(state.characters)) {
    if (char.status === 'dead') {
      for (const [itemName, item] of Object.entries(state.items)) {
        if (item.holder === charName && item.status === 'active') {
          errors.push(`Dead character "${charName}" is holding active item "${itemName}"`);
        }
      }
    }
  }

  // 2. Alive character at a destroyed location
  for (const [charName, char] of Object.entries(state.characters)) {
    if (char.status === 'alive' && char.location) {
      const loc = state.locations[char.location];
      if (loc && loc.status === 'destroyed') {
        errors.push(`Alive character "${charName}" is at destroyed location "${char.location}"`);
      }
    }
  }

  // 3. Active item at a destroyed location (unheld)
  for (const [itemName, item] of Object.entries(state.items)) {
    if (item.status === 'active' && !item.holder && item.location) {
      const loc = state.locations[item.location];
      if (loc && loc.status === 'destroyed') {
        errors.push(`Active item "${itemName}" is at destroyed location "${item.location}"`);
      }
    }
  }

  return errors;
}

// ---------------------------------------------------------------------------
// Plot Arcs
// ---------------------------------------------------------------------------

/**
 * Add a plot arc (unresolved story thread) to state.plotArcs.
 * @param {object} state
 * @param {{ id: string, description: string, status?: string, introducedInScene: number }} arc
 */
export function addPlotArc(state, { id, description, status, introducedInScene }) {
  state.plotArcs.push({ id, description, status: status || 'open', introducedInScene, resolvedInScene: null });
}

/**
 * Merge updates into an existing plot arc by id.
 * @param {object} state
 * @param {string} id
 * @param {object} updates
 */
export function updatePlotArc(state, id, updates) {
  const arc = state.plotArcs.find(a => a.id === id);
  if (!arc) throw new Error(`Plot arc not found: ${id}`);
  Object.assign(arc, updates);
}

/**
 * Return all plot arcs that are not yet resolved.
 * @param {object} state
 * @returns {object[]}
 */
export function getOpenPlotArcs(state) {
  return state.plotArcs.filter(a => a.status !== 'resolved');
}

/**
 * Mark a plot arc as resolved at the given scene index.
 * @param {object} state
 * @param {string} id
 * @param {number} sceneIndex
 */
export function resolvePlotArc(state, id, sceneIndex) {
  const arc = state.plotArcs.find(a => a.id === id);
  if (!arc) throw new Error(`Plot arc not found: ${id}`);
  arc.status = 'resolved';
  arc.resolvedInScene = sceneIndex;
}

// ---------------------------------------------------------------------------
// Character Arcs (5-stage model)
// ---------------------------------------------------------------------------

/**
 * Attach a 5-stage arc to a character.
 * @param {object} state
 * @param {string} name
 * @param {{ initial: string, trigger: string, dissonance: string, transformation: string, final: string }} arc
 */
export function setCharacterArc(state, name, arc) {
  if (!state.characters[name]) throw new Error(`Character not found: ${name}`);
  state.characters[name].arc = arc;
}

/**
 * Advance a character to a specific arc stage.
 * @param {object} state
 * @param {string} name
 * @param {'initial'|'trigger'|'dissonance'|'transformation'|'final'} stage
 */
export function advanceCharacterArc(state, name, stage) {
  if (!state.characters[name]) throw new Error(`Character not found: ${name}`);
  state.characters[name].currentArcStage = stage;
}

// ---------------------------------------------------------------------------
// Relationship Networks
// ---------------------------------------------------------------------------

/**
 * Add a directional relationship between two characters.
 * @param {object} state
 * @param {string} char1
 * @param {string} char2
 * @param {'ally'|'rival'|'lover'|'mentor'|'betrayer'|'neutral'} type
 * @param {string} description
 */
export function addRelationship(state, char1, char2, type, description) {
  if (!state.characters[char1]) throw new Error(`Character not found: ${char1}`);
  if (!state.characters[char2]) throw new Error(`Character not found: ${char2}`);
  if (!state.relationships) state.relationships = [];
  state.relationships.push({ char1, char2, type, description });
}

/**
 * Merge updates into an existing relationship (bidirectional lookup).
 * @param {object} state
 * @param {string} char1
 * @param {string} char2
 * @param {object} updates
 */
export function updateRelationship(state, char1, char2, updates) {
  if (!state.relationships) return;
  const rel = state.relationships.find(r =>
    (r.char1 === char1 && r.char2 === char2) || (r.char1 === char2 && r.char2 === char1)
  );
  if (rel) Object.assign(rel, updates);
}

/**
 * Return all relationships involving a character.
 * @param {object} state
 * @param {string} charName
 * @returns {object[]}
 */
export function getRelationships(state, charName) {
  if (!state.relationships) return [];
  return state.relationships.filter(r => r.char1 === charName || r.char2 === charName);
}

// ---------------------------------------------------------------------------
// Foreshadowing
// ---------------------------------------------------------------------------

/**
 * Plant a foreshadowing element in the story.
 * @param {object} state
 * @param {{ id: string, description: string, type: 'plant'|'reinforce'|'resolve', plantedInScene: number }} opts
 */
export function addForeshadowing(state, { id, description, type, plantedInScene }) {
  if (!state.foreshadowing) state.foreshadowing = [];
  state.foreshadowing.push({ id, description, type, plantedInScene, reinforcedInScenes: [], resolvedInScene: null });
}

/**
 * Record a scene where existing foreshadowing is reinforced.
 * @param {object} state
 * @param {string} id
 * @param {number} sceneIndex
 */
export function reinforceForeshadowing(state, id, sceneIndex) {
  if (!state.foreshadowing) return;
  const f = state.foreshadowing.find(x => x.id === id);
  if (f) f.reinforcedInScenes.push(sceneIndex);
}

/**
 * Mark foreshadowing as resolved (paid off) at a given scene.
 * @param {object} state
 * @param {string} id
 * @param {number} sceneIndex
 */
export function resolveForeshadowing(state, id, sceneIndex) {
  if (!state.foreshadowing) return;
  const f = state.foreshadowing.find(x => x.id === id);
  if (f) f.resolvedInScene = sceneIndex;
}

/**
 * Return foreshadowing elements that have not yet been resolved.
 * @param {object} state
 * @returns {object[]}
 */
export function getUnresolvedForeshadowing(state) {
  if (!state.foreshadowing) return [];
  return state.foreshadowing.filter(f => f.resolvedInScene === null);
}

// ---------------------------------------------------------------------------
// Serialization
// ---------------------------------------------------------------------------

/**
 * Serialize state to a JSON string.
 * @param {object} state
 * @returns {string}
 */
export function serialize(state) {
  return JSON.stringify(state, null, 2);
}

/**
 * Deserialize a JSON string back into a state object.
 * @param {string} json
 * @returns {object}
 */
export function deserialize(json) {
  return JSON.parse(json);
}

// ---------------------------------------------------------------------------
// Prompt formatting
// ---------------------------------------------------------------------------

/**
 * Format state as a human-readable string for use in LLM prompts.
 * Produces ### Characters, ### Items, and ### Locations sections.
 *
 * @param {object} state
 * @returns {string}
 */
export function toPromptContext(state) {
  const lines = [];

  lines.push('### Characters');
  for (const char of Object.values(state.characters)) {
    lines.push(`- ${char.name} [${char.status}] at ${char.location ?? 'unknown'}, emotional: ${char.emotional ?? 'unknown'}`);
    if (char.knowledge && char.knowledge.length > 0) {
      lines.push(`  knows: ${char.knowledge.join(', ')}`);
    }
  }
  if (Object.keys(state.characters).length === 0) lines.push('(none)');

  lines.push('');
  lines.push('### Items');
  for (const item of Object.values(state.items)) {
    const whereStr = item.holder
      ? `held by ${item.holder}`
      : item.location
        ? `at ${item.location}`
        : 'location unknown';
    lines.push(`- ${item.name} [${item.status}] ${whereStr}`);
  }
  if (Object.keys(state.items).length === 0) lines.push('(none)');

  lines.push('');
  lines.push('### Locations');
  for (const loc of Object.values(state.locations)) {
    lines.push(`- ${loc.name} [${loc.status}]`);
  }
  if (Object.keys(state.locations).length === 0) lines.push('(none)');

  // Plot arcs
  const openArcs = (state.plotArcs || []).filter(a => a.status !== 'resolved');
  if (openArcs.length > 0) {
    lines.push('');
    lines.push('### Open Plot Threads');
    for (const arc of openArcs) {
      lines.push(`- [${arc.status}] ${arc.description}`);
    }
  }

  // Relationships
  if (state.relationships && state.relationships.length > 0) {
    lines.push('');
    lines.push('### Relationships');
    for (const rel of state.relationships) {
      lines.push(`- ${rel.char1} ↔ ${rel.char2}: ${rel.type} (${rel.description})`);
    }
  }

  // Foreshadowing
  const unresolved = (state.foreshadowing || []).filter(f => f.resolvedInScene === null);
  if (unresolved.length > 0) {
    lines.push('');
    lines.push('### Active Foreshadowing');
    for (const f of unresolved) {
      lines.push(`- [${f.type}] ${f.description} (reinforced ${f.reinforcedInScenes.length}x)`);
    }
  }

  return lines.join('\n');
}
