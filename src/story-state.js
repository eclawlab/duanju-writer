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
 * @param {{ id: string, info: string, visibility: string, revealInScene: number }} revelation
 */
export function addRevelation(state, { id, info, visibility, revealInScene }) {
  state.revelations.push({ id, info, visibility, revealInScene, revealed: false });
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
 *  - Never include `never_explicit`.
 *  - Never include already-revealed entries.
 *
 * @param {object} state
 * @param {number} sceneIndex
 * @returns {object[]}
 */
export function getAvailableRevelations(state, sceneIndex) {
  return state.revelations.filter(r => {
    if (r.revealed) return false;
    if (r.visibility === 'never_explicit') return false;
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

  return lines.join('\n');
}
