import { test } from "node:test";
import assert from "node:assert/strict";

import {
  resolveUniquePath,
  PathCollisionResolver,
  generateNumericSuffix,
  generateTimestampSuffix,
} from "../src/core.js";

/**
 * Build an in-memory filesystem adapter. We track existence in a Set of
 * normalised strings (case-sensitive by default). Tests pass the contents up
 * front so there is no I/O and no wall-clock dependency.
 *
 * @param {string[]} existing
 * @returns {{existsSync: (path: string) => boolean, add: (path: string) => void}}
 */
function makeFs(existing) {
  const set = new Set(existing);
  return {
    existsSync: (path) => set.has(path),
    add: (path) => set.add(path),
  };
}

test("returns the original path when it does not exist", () => {
  const fs = makeFs([]);
  assert.equal(resolveUniquePath("report.pdf", fs), "report.pdf");
});

test("appends a numeric suffix when the original path exists", () => {
  const fs = makeFs(["report.pdf"]);
  assert.equal(resolveUniquePath("report.pdf", fs), "report (1).pdf");
});

test("skips taken numeric suffixes and finds the first free one", () => {
  const fs = makeFs(["report.pdf", "report (1).pdf", "report (2).pdf"]);
  assert.equal(resolveUniquePath("report.pdf", fs), "report (3).pdf");
});

test("handles files with no extension", () => {
  const fs = makeFs(["notes"]);
  assert.equal(resolveUniquePath("notes", fs), "notes (1)");
});

test("handles files with multiple dots preserving the last extension", () => {
  const fs = makeFs(["archive.tar.gz"]);
  assert.equal(resolveUniquePath("archive.tar.gz", fs), "archive.tar (1).gz");
});

test("does not treat dotfiles as having an extension", () => {
  const fs = makeFs([".bashrc"]);
  assert.equal(resolveUniquePath(".bashrc", fs), ".bashrc (1)");
});

test("preserves directory components in the path", () => {
  const fs = makeFs(["/tmp/work/report.pdf"]);
  assert.equal(
    resolveUniquePath("/tmp/work/report.pdf", fs),
    "/tmp/work/report (1).pdf"
  );
});

test("timestamp strategy appends the clock value before the extension", () => {
  const fs = makeFs(["data.log"]);
  const result = resolveUniquePath("data.log", fs, {
    strategy: "timestamp",
    now: () => 1700000000123,
  });
  assert.equal(result, "data-1700000000123.log");
});

test("timestamp strategy falls back to a numeric counter on same-ms collision", () => {
  const fs = makeFs(["data.log", "data-1700000000123.log"]);
  const result = resolveUniquePath("data.log", fs, {
    strategy: "timestamp",
    now: () => 1700000000123,
  });
  assert.equal(result, "data-1700000000123 (2).log");
});

test("timestamp strategy without a clock function throws a TypeError", () => {
  const fs = makeFs(["data.log"]);
  assert.throws(
    () => resolveUniquePath("data.log", fs, { strategy: "timestamp" }),
    /timestamp.*now/i
  );
});

test("transform is applied before the existence check (case-insensitive collision)", () => {
  // Simulate a case-insensitive filesystem: "Report.pdf" and "report.pdf"
  // are the same file.
  const fs = makeFs(["report.pdf"]);
  const result = resolveUniquePath("Report.pdf", fs, {
    transform: (p) => p.toLowerCase(),
  });
  assert.equal(result, "Report (1).pdf");
});

test("class-based resolver reuses options across multiple calls", () => {
  const fs = makeFs([]);
  const resolver = new PathCollisionResolver(fs, { strategy: "numeric" });
  assert.equal(resolver.resolve("a.txt"), "a.txt");
  fs.add("a.txt");
  assert.equal(resolver.resolve("a.txt"), "a (1).txt");
});

test("generateNumericSuffix places the counter before the extension", () => {
  assert.equal(generateNumericSuffix("file.txt", 7), "file (7).txt");
  assert.equal(generateNumericSuffix("file", 2), "file (2)");
  assert.equal(generateNumericSuffix(".hidden", 3), ".hidden (3)");
});

test("generateTimestampSuffix produces the expected shape with and without fallback", () => {
  assert.equal(
    generateTimestampSuffix("file.txt", 123),
    "file-123.txt"
  );
  assert.equal(
    generateTimestampSuffix("file.txt", 123, 2),
    "file-123 (2).txt"
  );
});
