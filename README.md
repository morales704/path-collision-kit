# path-collision-kit

Generates non-clobbering filenames by appending numeric or timestamp suffixes when target paths already exist.

## Usage

```js
import { PathCollisionResolver } from "path-collision-kit";

// For production use, pass a thin adapter over fs.existsSync:
import { existsSync } from "node:fs";

const resolver = new PathCollisionResolver(
  { existsSync },
  { strategy: "numeric" } // default; also "timestamp"
);

resolver.resolve("report.pdf"); // "report.pdf" if free, else "report (1).pdf", "report (2).pdf", ...

// Timestamp strategy (requires a clock function so tests stay deterministic):
const tsResolver = new PathCollisionResolver(
  { existsSync },
  { strategy: "timestamp", now: () => Date.now() }
);
// => "report-1700000000123.pdf", falling back to "report-1700000000123 (2).pdf" on same-ms collisions.
```

## Why this exists

Writing a file to a path that already exists usually means either silently overwriting something the user wanted to keep, or failing the operation and pushing the decision back onto them. This library finds the next free variant of the requested name so the write succeeds without clobbering. It is deliberately small: no file writing, no promise of cross-filesystem atomicity, no symlink chasing. The caller decides when and whether to call `resolve`, then does the write.

## Exports

- `resolveUniquePath(originalPath, fsAdapter, options)` — functional entry point.
- `PathCollisionResolver` — class that binds `fsAdapter` and `options` for reuse.
- `generateNumericSuffix(path, counter)` — pure helper, returns `"file (n).ext"`.
- `generateTimestampSuffix(path, timestamp, fallback?)` — pure helper, returns `"file-<ts>.ext"` (or `… (n).ext` when `fallback > 1`).

`fsAdapter` is any object with `existsSync(path) -> boolean`. Tests typically pass a fake backed by a `Set`.

## Interpreting the brief

One ambiguity worth naming: "path" could mean a full filesystem path or a bare filename. This library treats the input as an opaque string and only splits on the last `/` and the last `.` so directory components and multi-dot extensions behave sensibly. It does not normalise separators, resolve symlinks, or canonicalise `..` — the caller is expected to hand it an already-normalised path.

## Awkward edges

- **Case-insensitive filesystems** (macOS APFS default, Windows NTFS default). "Report.pdf" and "report.pdf" collide on disk but not in a plain `Set`. Pass a `transform` (typically `p => p.toLowerCase()`) so the existence check uses the same view the filesystem does. The returned path keeps the original case.
- **Dotfiles.** `.bashrc` has no extension by this library's convention; the suffix goes at the end: `.bashrc (1)`.
- **Timestamp collisions.** Two calls within the same millisecond produce the same suffix. The timestamp strategy detects this and appends a numeric fallback (`(2)`, `(3)`, …) so the result is still unique.
