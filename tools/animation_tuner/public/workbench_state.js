(function initWorkbenchState(root, factory) {
  const api = factory();
  if (typeof module === "object" && module.exports) module.exports = api;
  if (root) root.FrameTunerState = api;
})(typeof globalThis !== "undefined" ? globalThis : this, () => {
  // Only the most recently requested selection may publish a loaded context.
  function createLatestTask() {
    let generation = 0;
    return {
      invalidate() { generation += 1; },
      async run(load, commit, reportError = (error) => { throw error; }) {
        const ticket = ++generation;
        try {
          const result = await load(() => ticket === generation);
          if (ticket !== generation) return false;
          await commit(result);
          return ticket === generation;
        } catch (error) {
          if (ticket !== generation) return false;
          reportError(error);
          return false;
        }
      },
    };
  }

  async function mapConcurrent(values, worker, concurrency = 4, isCurrent = () => true) {
    const items = Array.from(values);
    const results = new Array(items.length);
    let cursor = 0;
    await Promise.all(Array.from({ length: Math.min(items.length, Math.max(1, concurrency)) }, async () => {
      while (cursor < items.length && isCurrent()) {
        const index = cursor++;
        results[index] = await worker(items[index], index);
      }
    }));
    return results;
  }

  // Current selection assets are pinned; background resources use a bounded LRU.
  // Clearing the cache detaches pending requests so old projects cannot refill it.
  function createResourceCache({ load, key, maxEntries = 256, maxBytes = 128 * 1024 * 1024, size = () => 0 }) {
    const entries = new Map();
    let pinned = new Set();
    let bytes = 0;
    const evict = () => {
      for (const [entryKey, entry] of entries) {
        if (entries.size <= maxEntries && bytes <= maxBytes) break;
        if (pinned.has(entryKey) || !entry.resolved) continue;
        entries.delete(entryKey);
        bytes -= entry.bytes;
      }
    };
    return {
      get(resource) {
        const entryKey = key(resource);
        let entry = entries.get(entryKey);
        if (entry) {
          entries.delete(entryKey);
          entries.set(entryKey, entry);
          return entry.promise;
        }
        entry = { resolved: false, bytes: 0, value: null, promise: null };
        entries.set(entryKey, entry);
        entry.promise = Promise.resolve().then(() => load(resource)).then((value) => {
          if (entries.get(entryKey) === entry) {
            entry.resolved = true;
            entry.value = value;
            entry.bytes = Math.max(0, Number(size(value)) || 0);
            bytes += entry.bytes;
            evict();
          }
          return value;
        }, (error) => {
          if (entries.get(entryKey) === entry) entries.delete(entryKey);
          throw error;
        });
        return entry.promise;
      },
      peek(resource) { return entries.get(key(resource))?.value || null; },
      pin(resources) { pinned = new Set(Array.from(resources, key)); evict(); },
      clear() { entries.clear(); pinned.clear(); bytes = 0; },
      stats() { return { entries: entries.size, bytes, pinned: pinned.size }; },
    };
  }

  return { createLatestTask, mapConcurrent, createResourceCache };
});
