/**
 * Core implementation of the path collision resolver.
 */

/**
 * A minimal virtual filesystem adapter. The default implementation uses Node's
 * fs module, but tests pass in a fake that tracks paths in a Set so assertions
 * are completely deterministic — no real disk state to worry about.
 *
 * @typedef {Object} FilesystemAdapter
 * @property {(path: string) => boolean} existsSync - Returns true if the path exists.
 */

/**
 * @typedef {Object} ResolverOptions
 * @property {'numeric' | 'timestamp'} [strategy='numeric']
 *   Suffix style: "numeric" tries 1, 2, 3…; "timestamp" uses a clock function.
 * @property {(path: string) => string} [transform]
 *   Post-processing applied to the full path AFTER a suffix is incorporated.
 *   Used for case-lowering so case-insensitive collisions are detected.
 * @property {() => number} [now]
 *   Clock function (ms since epoch). Required for the timestamp strategy.
 *   Passing a fake clock in tests is the only way to make timestamp tests
 *   deterministic.
 * @property {number} [maxAttempts=100000]
 *   Safety valve so a pathological loop can't hang the process.
 */

/**
 * Parse a path into a base and extension. "Extension" is the portion from the
 * last dot in the filename, but only if that dot is not the first character
 * (which would make it a dotfile like ".bashrc" with no extension).
 *
 * "archive.tar.gz" -> base "archive.tar", ext ".gz"
 * ".bashrc"         -> base ".bashrc", ext ""
 * "file"            -> base "file",   ext ""
 *
 * @param {string} path
 * @returns {{base: string, ext: string}}
 */
function splitPath(path) {
  const base = path.slice(0, Math.max(path.lastIndexOf("/"), -1) + 1);
  const filename = path.slice(Math.max(path.lastIndexOf("/"), -1) + 1);

  // Find the last dot in the filename; ignore it if it is at position 0
  // (leading-dot files like ".bashrc" have no extension by convention).
  const dot = filename.lastIndexOf(".");
  const sep = dot > 0 ? dot : filename.length;

  const stem = filename.slice(0, sep);
  const ext = filename.slice(sep);
  return { base: base + stem, ext };
}

/**
 * Build a candidate path for the numeric strategy.
 *
 * "report.pdf", 3 -> "report (3).pdf"
 * "file",        5 -> "file (5)"
 *
 * Suffix goes BEFORE the extension so the extension is preserved on every
 * candidate. This matters because consumers usually want to open the file with
 * the same application regardless of which collision-variant it is.
 *
 * @param {string} originalPath
 * @param {number} counter
 * @returns {string}
 */
export function generateNumericSuffix(originalPath, counter) {
  const { base, ext } = splitPath(originalPath);
  return `${base} (${counter})${ext}`;
}

/**
 * Build a candidate path for the timestamp strategy.
 *
 * "report.pdf", 1700000000123 -> "report-1700000000123.pdf"
 * "file",        1700000000123 -> "file-1700000000123"
 *
 * Timestamps go before the extension for the same reason as numeric suffixes.
 * If the timestamp happens to collide (same millisecond, same original name)
 * we fall back to appending a numeric counter so the result is still unique.
 *
 * @param {string} originalPath
 * @param {number} timestamp
 * @param {number} [fallback=1]
 * @returns {string}
 */
export function generateTimestampSuffix(originalPath, timestamp, fallback = 1) {
  const { base, ext } = splitPath(originalPath);
  if (fallback > 1) {
    return `${base}-${timestamp} (${fallback})${ext}`;
  }
  return `${base}-${timestamp}${ext}`;
}

/**
 * @param {string} path
 * @returns {boolean}
 */
function defaultExistsSync(path) {
  // Lazy-require fs so the module can be imported in environments where
  // "fs" is shimmed but not eagerly evaluated.
  const { existsSync } = require("fs");
  return existsSync(path);
}

/**
 * Resolves a non-clobbering path for a given target.
 *
 * If the requested path does not exist, it is returned unchanged. Otherwise
 * the resolver appends a suffix (numeric or timestamp) and increments until it
 * finds a path that does not exist.
 *
 * The caller can pass a `transform` function applied to each candidate path
 * before the existence check. The most common use is lowercasing on
 * case-insensitive filesystems (macOS APFS default, Windows NTFS default) so
 * that "Report.pdf" and "report.pdf" are treated as the same file.
 *
 * @param {string} originalPath
 * @param {FilesystemAdapter} fsAdapter
 * @param {ResolverOptions} [options]
 * @returns {string}
 */
export function resolveUniquePath(originalPath, fsAdapter, options = {}) {
  const {
    strategy = "numeric",
    transform = null,
    now = null,
    maxAttempts = 100000,
  } = options;

  /**
   * Apply transform (if any) before the existence check so that two names
   * that differ only in case are treated as the same path on
   * case-insensitive filesystems.
   */
  const view = transform
    ? (/** @type {string} */ p) => transform(p)
    : (/** @type {string} */ p) => p;

  if (!fsAdapter.existsSync(view(originalPath))) {
    return originalPath;
  }

  if (strategy === "timestamp") {
    if (typeof now !== "function") {
      throw new TypeError(
        "resolveUniquePath: the 'timestamp' strategy requires a 'now' clock function. " +
          "Pass `now: () => Date.now()` for production or a fake for tests."
      );
    }
    const ts = now();
    let fallback = 1;
    for (let i = 0; i < maxAttempts; i++) {
      const candidate = generateTimestampSuffix(originalPath, ts, fallback);
      if (!fsAdapter.existsSync(view(candidate))) {
        return candidate;
      }
      fallback++;
    }
    throw new Error(
      `resolveUniquePath: exceeded ${maxAttempts} attempts for "${originalPath}"`
    );
  }

  if (strategy === "numeric") {
    let counter = 1;
    for (let i = 0; i < maxAttempts; i++) {
      const candidate = generateNumericSuffix(originalPath, counter);
      if (!fsAdapter.existsSync(view(candidate))) {
        return candidate;
      }
      counter++;
    }
    throw new Error(
      `resolveUniquePath: exceeded ${maxAttempts} attempts for "${originalPath}"`
    );
  }

  throw new TypeError(
    `resolveUniquePath: unknown strategy "${strategy}". Use 'numeric' or 'timestamp'.`
  );
}

/**
 * Class wrapper for resolveUniquePath. The advantage of the class is that the
 * filesystem adapter, transform, and clock can be configured once at
 * construction time and reused across many calls.
 */
export class PathCollisionResolver {
  /**
   * @param {FilesystemAdapter} fsAdapter
   * @param {ResolverOptions} [options]
   */
  constructor(fsAdapter, options = {}) {
    this.fsAdapter = fsAdapter;
    this.options = options;
  }

  /**
   * @param {string} originalPath
   * @returns {string}
   */
  resolve(originalPath) {
    return resolveUniquePath(originalPath, this.fsAdapter, this.options);
  }
}

export { defaultExistsSync };
