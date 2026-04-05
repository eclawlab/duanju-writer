import { readFileSync, readdirSync } from 'node:fs';
import { join, basename, extname } from 'node:path';

/**
 * Split text into chunks of approximately maxChunkSize characters.
 * Splits on paragraph boundaries (double newline) first, then on sentence
 * boundaries if a paragraph is too long. Never splits mid-sentence.
 *
 * @param {string} text
 * @param {number} maxChunkSize
 * @returns {string[]}
 */
export function chunkText(text, maxChunkSize = 500) {
  const paragraphs = text.split(/\n\n+/);
  const chunks = [];

  for (const paragraph of paragraphs) {
    const trimmed = paragraph.trim();
    if (!trimmed) continue;

    if (trimmed.length <= maxChunkSize) {
      chunks.push(trimmed);
    } else {
      // Split the paragraph into sentences.
      // We split on boundaries like ". ", "! ", "? " keeping the punctuation with the preceding sentence.
      const parts = trimmed.split(/(?<=[.!?])\s+/);
      let current = '';

      for (const part of parts) {
        const candidate = current ? `${current} ${part}` : part;
        if (candidate.length <= maxChunkSize) {
          current = candidate;
        } else {
          if (current) {
            chunks.push(current.trim());
          }
          current = part;
        }
      }

      if (current.trim()) {
        chunks.push(current.trim());
      }
    }
  }

  return chunks.filter(c => c.length > 0);
}

/**
 * Read a file, chunk it, and add all chunks to the vector store.
 *
 * @param {object} store  - vector store with addBatch(items)
 * @param {string} filePath
 * @param {object} metadata - extra metadata to attach to each chunk
 * @returns {{ chunks: number, source: string }}
 */
export async function importDocument(store, filePath, metadata = {}) {
  const text = readFileSync(filePath, 'utf8');
  const chunks = chunkText(text);

  // Derive base name without extension, e.g. "worldbuilding.txt" → "worldbuilding"
  const name = basename(filePath, extname(filePath));

  const items = chunks.map((chunk, i) => ({
    id: `knowledge_${name}_${i}`,
    text: chunk,
    metadata: { ...metadata, source: filePath, chunkIndex: i },
  }));

  store.addBatch(items);

  return { chunks: chunks.length, source: filePath };
}

/**
 * Read all .txt and .md files in a directory and import each into the store.
 *
 * @param {object} store
 * @param {string} dirPath
 * @param {object} metadata
 * @returns {{ files: number, totalChunks: number }}
 */
export async function importDirectory(store, dirPath, metadata = {}) {
  const entries = readdirSync(dirPath);
  const files = entries.filter(f => {
    const ext = extname(f).toLowerCase();
    return ext === '.txt' || ext === '.md';
  });

  let totalChunks = 0;
  for (const file of files) {
    const filePath = join(dirPath, file);
    const result = await importDocument(store, filePath, metadata);
    totalChunks += result.chunks;
  }

  return { files: files.length, totalChunks };
}

/**
 * Query the knowledge base, filtering out scene entries that are temporally
 * close to the current scene (within 3 scenes) and scenes from non-ancestor
 * episodes (cross-branch pollution).
 *
 * @param {object} store
 * @param {string} query
 * @param {number} k        - number of results to return
 * @param {number|null} currentSceneIndex
 * @param {Set|null} ancestorEpisodeIndices - if provided, only include scenes from these episodes
 * @returns {{ id: string, text: string, score: number, metadata: object }[]}
 */
export async function queryKnowledge(store, query, k = 5, currentSceneIndex = null, ancestorEpisodeIndices = null) {
  const raw = store.search(query, k * 3);

  const filtered = raw.filter(result => {
    const { sceneIndex, episodeIndex } = result.metadata || {};

    // Knowledge entries (no sceneIndex) are always included
    if (sceneIndex === undefined || sceneIndex === null) return true;

    // Filter out scenes from non-ancestor episodes (prevents cross-branch leakage)
    if (ancestorEpisodeIndices && episodeIndex !== undefined) {
      if (!ancestorEpisodeIndices.has(episodeIndex)) return false;
    }

    // If we have no reference scene, include all
    if (currentSceneIndex === null || currentSceneIndex === undefined) return true;

    // Filter out scene entries within 3 scenes of currentSceneIndex
    return Math.abs(sceneIndex - currentSceneIndex) > 3;
  });

  return filtered.slice(0, k);
}
