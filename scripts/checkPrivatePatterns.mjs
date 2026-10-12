// Pre-commit guard for the public repository (CLAUDE.md, "Public repository
// rules"). Refuses a commit whose staged content contains any line of
// docs-private/forbidden-patterns.txt: the server's address, key names,
// personal addresses, local paths. The pattern file is git-ignored, so the
// values it guards never enter the tree, and a contributor without it is
// simply not checked. Output names the file, the line and the pattern's
// position in the list, never the matched text, so a terminal log stays
// clean.
import { execFileSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";

const PATTERNS = "docs-private/forbidden-patterns.txt";
if (!existsSync(PATTERNS)) process.exit(0);

const patterns = readFileSync(PATTERNS, "utf8")
  .split(/\r?\n/)
  .map((l) => l.trim())
  .filter((l) => l !== "" && !l.startsWith("#"));
if (patterns.length === 0) process.exit(0);

const staged = execFileSync(
  "git",
  ["diff", "--cached", "--name-only", "-z", "--diff-filter=ACMR"],
  { encoding: "utf8" },
)
  .split("\0")
  .filter((f) => f !== "");

const hits = [];
for (const file of staged) {
  let content;
  try {
    content = execFileSync("git", ["show", `:${file}`], {
      encoding: "utf8",
      maxBuffer: 64 * 1024 * 1024,
    });
  } catch {
    continue; // binary or unreadable: nothing to grep
  }
  if (content.includes("\0")) continue;
  const lines = content.split("\n");
  lines.forEach((line, i) => {
    patterns.forEach((p, j) => {
      if (line.includes(p))
        hits.push(`${file}:${i + 1} matches pattern #${j + 1}`);
    });
  });
}

if (hits.length > 0) {
  console.error(
    `Refusing to commit: ${hits.length} line(s) match ${PATTERNS} (private values must never enter the repository).`,
  );
  for (const h of hits) console.error(`  ${h}`);
  process.exit(1);
}
