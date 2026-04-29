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

