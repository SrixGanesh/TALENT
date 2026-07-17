// window.storage only exists inside Claude.ai artifacts.
// This shim recreates the same API using localStorage so ZoneApp.jsx
// runs unmodified in a normal browser / local dev server.
// Imported once in main.jsx, before the app renders.

if (typeof window !== "undefined" && !window.storage) {
  window.storage = {
    async get(key /*, shared */) {
      const raw = localStorage.getItem(key);
      if (raw === null) {
        throw new Error(`Key not found: ${key}`);
      }
      return { key, value: raw };
    },
    async set(key, value /*, shared */) {
      localStorage.setItem(key, value);
      return { key, value };
    },
    async delete(key /*, shared */) {
      localStorage.removeItem(key);
      return { key, deleted: true };
    },
    async list(prefix = "" /*, shared */) {
      const keys = Object.keys(localStorage).filter((k) => k.startsWith(prefix));
      return { keys, prefix };
    },
  };
}
