import { statSync } from 'node:fs';
import { join } from 'node:path';
import { DATA_DIR, JOBS_DIR } from '../constants.js';
import { createStore } from '../vectorstore.js';
import { importDocument, importDirectory } from '../knowledge.js';

// Resolve the vector-store path: a per-job store via `--job <id>`, else the
// global knowledge base. Previously inlined three times across the import/clear/
// info branches — and the `info` branch referenced storePath/createStore that
// were block-scoped to the `clear` branch, so `knowledge info` threw
// "storePath is not defined". Centralizing fixes that.
function resolveStorePath(args) {
  const jobIdx = args.indexOf('--job');
  if (jobIdx !== -1 && args[jobIdx + 1]) {
    return join(JOBS_DIR, args[jobIdx + 1], 'vectorstore.json');
  }
  return join(DATA_DIR, 'knowledge.json');
}

// `duanju-writer knowledge [import|clear|info] [path] [--job jobId]`
export async function handleKnowledge(args) {
  const sub = args[0];
  const storePath = resolveStorePath(args);

  if (sub === 'import' && args[1]) {
    const target = args[1];
    const store = createStore(storePath);
    store.load();
    try {
      const stat = statSync(target);
      if (stat.isDirectory()) {
        const result = await importDirectory(store, target);
        store.save();
        console.log(`Imported ${result.files} files (${result.totalChunks} chunks) into knowledge base`);
      } else {
        const result = await importDocument(store, target);
        store.save();
        console.log(`Imported "${target}" (${result.chunks} chunks) into knowledge base`);
      }
    } catch (err) {
      console.log(`Failed to import: ${err.message}`);
      process.exit(1);
    }

  } else if (sub === 'clear') {
    const store = createStore(storePath);
    store.clear();
    console.log('Knowledge base cleared.');

  } else if (sub === 'info') {
    const store = createStore(storePath);
    store.load();
    console.log(`Knowledge base: ${store.size()} entries`);
    console.log(`Store path: ${storePath}`);

  } else {
    console.log('Usage: duanju-writer knowledge [import|clear|info] [path] [--job jobId]');
    console.log('\nExamples:');
    console.log('  duanju-writer knowledge import ./my-worldbuilding.txt');
    console.log('  duanju-writer knowledge import ./reference-docs/');
    console.log('  duanju-writer knowledge info');
    console.log('  duanju-writer knowledge clear');
  }
}
