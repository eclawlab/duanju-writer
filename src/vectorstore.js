import { readFileSync, writeFileSync, unlinkSync, existsSync, mkdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { homedir } from 'node:os';
import { JOBS_DIR } from './constants.js';

const STOPWORDS = new Set([
  'the', 'a', 'an', 'is', 'are', 'was', 'were', 'in', 'on', 'at', 'to',
  'for', 'of', 'and', 'or', 'but', 'not', 'with', 'this', 'that', 'it',
  'he', 'she', 'they', 'we', 'you', 'i', 'my', 'your', 'his', 'her',
  'its', 'our', 'their',
]);

/**
 * Tokenize text: lowercase, strip punctuation, filter stopwords.
 * @param {string} text
 * @returns {string[]}
 */
export function tokenize(text) {
  return text
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, ' ')
    .split(/\s+/)
    .filter(t => t.length > 0 && !STOPWORDS.has(t));
}

/**
 * Build TF-IDF index from an array of { id, text } documents.
 * @param {{ id: string, text: string }[]} documents
 * @returns {{ vocabulary: string[], idf: number[], docVectors: { id: string, vector: number[] }[] }}
 */
export function buildTfidf(documents) {
  const N = documents.length;

  // Tokenize all documents
  const tokenizedDocs = documents.map(doc => ({
    id: doc.id,
    tokens: tokenize(doc.text),
  }));

  // Build vocabulary (unique terms, sorted for determinism)
  const vocabSet = new Set();
  for (const { tokens } of tokenizedDocs) {
    for (const t of tokens) vocabSet.add(t);
  }
  const vocabulary = Array.from(vocabSet).sort();
  const termIndex = new Map(vocabulary.map((t, i) => [t, i]));

  // Compute document frequency for each term
  const df = new Array(vocabulary.length).fill(0);
  for (const { tokens } of tokenizedDocs) {
    const seen = new Set(tokens);
    for (const t of seen) {
      const idx = termIndex.get(t);
      if (idx !== undefined) df[idx]++;
    }
  }

  // Compute IDF: log(N / (1 + df))
  const idf = df.map(d => Math.log(N / (1 + d)));

  // Compute TF-IDF vector for each document
  const docVectors = tokenizedDocs.map(({ id, tokens }) => {
    const vector = new Array(vocabulary.length).fill(0);
    const totalTerms = tokens.length;
    if (totalTerms === 0) return { id, vector };

    const termCounts = new Map();
    for (const t of tokens) {
      termCounts.set(t, (termCounts.get(t) || 0) + 1);
    }

    for (const [term, count] of termCounts) {
      const idx = termIndex.get(term);
      if (idx !== undefined) {
        const tf = count / totalTerms;
        vector[idx] = tf * idf[idx];
      }
    }

    return { id, vector };
  });

  return { vocabulary, idf, docVectors };
}

/**
 * Compute cosine similarity between two numeric vectors.
 * @param {number[]} a
 * @param {number[]} b
 * @returns {number} 0.0–1.0
 */
export function cosineSimilarity(a, b) {
  let dot = 0;
  let normA = 0;
  let normB = 0;
  for (let i = 0; i < a.length; i++) {
    dot += a[i] * b[i];
    normA += a[i] * a[i];
    normB += b[i] * b[i];
  }
  if (normA === 0 || normB === 0) return 0;
  return dot / (Math.sqrt(normA) * Math.sqrt(normB));
}

/**
 * Create a vector store backed by a JSON file.
 * @param {string} filepath
 */
export function createStore(filepath) {
  /** @type {Map<string, { id: string, text: string, metadata: object, tokens: string[] }>} */
  const entries = new Map();
  let indexCache = null; // { vocabulary, idf, docVectors } — invalidated on mutation

  function invalidateCache() {
    indexCache = null;
  }

  function getIndex() {
    if (!indexCache) {
      const docs = Array.from(entries.values()).map(e => ({ id: e.id, text: e.text }));
      indexCache = buildTfidf(docs);
    }
    return indexCache;
  }

  return {
    /**
     * Add a single document.
     * @param {string} id
     * @param {string} text
     * @param {object} metadata
     */
    add(id, text, metadata = {}) {
      const tokens = tokenize(text);
      entries.set(id, { id, text, metadata, tokens });
      invalidateCache();
    },

    /**
     * Add multiple documents at once.
     * @param {{ id: string, text: string, metadata: object }[]} items
     */
    addBatch(items) {
      for (const { id, text, metadata } of items) {
        const tokens = tokenize(text);
        entries.set(id, { id, text, metadata: metadata || {}, tokens });
      }
      invalidateCache();
    },

    /**
     * Search for top-k documents most similar to query.
     * @param {string} query
     * @param {number} k
     * @returns {{ id: string, text: string, metadata: object, score: number }[]}
     */
    search(query, k = 3) {
      if (entries.size === 0) return [];

      const { vocabulary, idf, docVectors } = getIndex();

      // Build query vector using same vocabulary
      const queryTokens = tokenize(query);
      const queryVector = new Array(vocabulary.length).fill(0);

      if (queryTokens.length > 0) {
        const termIndex = new Map(vocabulary.map((t, i) => [t, i]));
        const termCounts = new Map();
        for (const t of queryTokens) {
          termCounts.set(t, (termCounts.get(t) || 0) + 1);
        }
        for (const [term, count] of termCounts) {
          const idx = termIndex.get(term);
          if (idx !== undefined) {
            const tf = count / queryTokens.length;
            queryVector[idx] = tf * idf[idx];
          }
        }
      }

      // Score each document
      const scored = docVectors.map(({ id, vector }) => {
        const entry = entries.get(id);
        return {
          id,
          text: entry.text,
          metadata: entry.metadata,
          score: cosineSimilarity(queryVector, vector),
        };
      });

      // Sort by score descending, return top-k
      scored.sort((a, b) => b.score - a.score);
      return scored.slice(0, k);
    },

    /**
     * Remove an entry by id.
     * @param {string} id
     */
    remove(id) {
      entries.delete(id);
      invalidateCache();
    },

    /**
     * Persist store to JSON file.
     */
    save() {
      const dir = dirname(filepath);
      mkdirSync(dir, { recursive: true });
      const data = {
        entries: Array.from(entries.values()),
      };
      writeFileSync(filepath, JSON.stringify(data, null, 2), 'utf8');
    },

    /**
     * Load store from JSON file (if it exists).
     */
    load() {
      if (!existsSync(filepath)) return;
      try {
        const raw = readFileSync(filepath, 'utf8');
        const data = JSON.parse(raw);
        entries.clear();
        for (const entry of data.entries || []) {
          entries.set(entry.id, entry);
        }
        invalidateCache();
      } catch {
        // silently ignore corrupt files
      }
    },

    /**
     * Clear all entries and delete the file if it exists.
     */
    clear() {
      entries.clear();
      invalidateCache();
      if (existsSync(filepath)) {
        unlinkSync(filepath);
      }
    },

    /**
     * Return number of entries.
     * @returns {number}
     */
    size() {
      return entries.size;
    },
  };
}

/**
 * Get the path for a per-job vector store.
 * @param {string} jobId
 * @returns {string}
 */
export function getStoreDir(jobId) {
  return join(JOBS_DIR, jobId, 'vectorstore.json');
}
