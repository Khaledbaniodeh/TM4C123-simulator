/*
 * Browser-local drafts of the student's work, so a reload or an accidental
 * example switch does not lose it:
 *   - the circuit, as diagram.json text (same key and format as before), and
 *   - the firmware source, with the example it started from (null source =
 *     the example's own, unedited code).
 *
 * Storage may be missing (blocked or private mode), full, or hold unreadable
 * data. Every write reports whether it really happened, so the page never
 * claims a save that did not occur. Unreadable entries are set aside under
 * an ":unreadable" key instead of being overwritten. Local storage belongs
 * to one browser profile; it is not a backup and is never synchronized.
 */

export const DIAGRAM_KEY = "tm4c123-simulator:diagram-draft";
export const SOURCE_KEY = "tm4c123-simulator:source-draft";
const SOURCE_VERSION = 1;

/** The browser's localStorage, or null when the page may not use it. */
export function browserStorage() {
  try {
    return globalThis.localStorage ?? null;
  } catch {
    return null; // SecurityError: storage disabled for this site
  }
}

/** Parses a stored source draft; null when it is not one this version wrote. */
export function parseSourceDraft(text) {
  try {
    const value = JSON.parse(text);
    if (value?.version !== SOURCE_VERSION) {
      return null;
    }
    const { exampleId, source } = value;
    if ((exampleId !== null && typeof exampleId !== "string") || (source !== null && typeof source !== "string")) {
      return null;
    }
    return { exampleId, source };
  } catch {
    return null;
  }
}

/** Which parts of the work differ from the example it started from. */
export function compareWork(current, baseline) {
  return {
    source: current.source !== baseline.source,
    circuit: current.diagramText !== baseline.diagramText,
  };
}

export class DraftStore {
  #storage;
  #saved = new Set();
  #failed = new Map();

  constructor(storage) {
    this.#storage = storage ?? null;
  }

  /**
   * "unavailable" (no storage), "failed" (a draft could not be written),
   * "saved" (every draft written so far was stored), or "idle" (nothing written yet).
   */
  get status() {
    if (!this.#storage) {
      return "unavailable";
    }
    if (this.#failed.size) {
      return "failed";
    }
    return this.#saved.size ? "saved" : "idle";
  }

  /** The error of a failed write, if any (for the console). */
  get lastError() {
    return [...this.#failed.values()].at(-1) ?? null;
  }

  /**
   * Reads both drafts. `parseDiagram(text)` returns `{ diagram }` (null when invalid).
   * `unreadable` lists drafts that were present but could not be used.
   */
  read(parseDiagram) {
    const unreadable = [];
    let diagram = null;
    const diagramText = this.#get(DIAGRAM_KEY);
    if (diagramText !== null) {
      diagram = parseDiagram(diagramText)?.diagram ?? null;
      if (!diagram) {
        this.#setAside(DIAGRAM_KEY, diagramText);
        unreadable.push("circuit");
      }
    }
    let source = null;
    const sourceText = this.#get(SOURCE_KEY);
    if (sourceText !== null) {
      source = parseSourceDraft(sourceText);
      if (!source) {
        this.#setAside(SOURCE_KEY, sourceText);
        unreadable.push("source");
      }
    }
    return { diagram, source, unreadable };
  }

  saveDiagram(text) {
    return this.#set(DIAGRAM_KEY, text);
  }

  saveSource({ exampleId, source }) {
    return this.#set(SOURCE_KEY, JSON.stringify({ version: SOURCE_VERSION, exampleId, source }));
  }

  #get(key) {
    try {
      return this.#storage?.getItem(key) ?? null;
    } catch {
      return null;
    }
  }

  #set(key, value) {
    if (!this.#storage) {
      return false;
    }
    try {
      this.#storage.setItem(key, value);
      this.#failed.delete(key);
      this.#saved.add(key);
      return true;
    } catch (error) {
      this.#failed.set(key, error);
      return false;
    }
  }

  #setAside(key, text) {
    try {
      this.#storage.setItem(`${key}:unreadable`, text);
      this.#storage.removeItem(key);
    } catch {
      // Leave it in place: better unread than lost.
    }
  }
}
