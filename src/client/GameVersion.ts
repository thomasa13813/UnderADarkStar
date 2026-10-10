import version from "resources/version.txt?raw";
import { ClientEnv } from "./ClientEnv";

// A build HAS a version only if it was tagged. resources/version.txt ships as
// the placeholder "x.xx.xx" and only a tagged deploy overwrites it:
// .github/workflows/release.yml hands build.sh a third argument, which
// build.sh writes to the file, while every untagged deploy goes through
// build-deploy.sh, which passes two arguments and leaves the placeholder in
// the tree. So the nav bar and footer read "vx.xx.xx" on every nightly, every
// staging deploy and every Steam depot build -- a label naming no build at
// all, and the one thing a player is asked to quote in a bug report.
// Two or three numeric parts, so "V0.01" (the pre-release label chosen
// 2026-10-07) counts as a version alongside "v0.33.18". A leading V or v is
// kept as written; one is added when the file has none.
const VERSION_RE = /^[vV]?\d+\.\d+(\.\d+)?/;
const SHA_RE = /^[0-9a-f]{7,40}$/i;
const SHORT_COMMIT_LENGTH = 7;

/**
 * The label identifying this client build.
 *
 * Show the version when the build has one, and the 7-char commit when it does
 * not -- the same rule the Electron shell applies to its own half of the
 * footer line (OPE-358), so "v0.33.18 (Steam v0.1.0)" and
 * "bf739f8 (Steam a1b2c3d)" are both self-consistent rather than one half
 * naming a build and the other a placeholder.
 *
 * Pure, and takes both inputs, so the nav bar and the footer cannot drift:
 * they are two renderings of one answer, not two derivations of it.
 */
export function composeGameVersion(
  rawVersion: string,
  gitCommit: string,
): string {
  const trimmed = rawVersion.trim();
  const withV = withVersionPrefix(trimmed);
  if (VERSION_RE.test(trimmed)) return withV;

  // Untagged, so the commit is the only thing identifying this build.
  const commit = gitCommit.trim();
  if (SHA_RE.test(commit)) {
    return commit.slice(0, SHORT_COMMIT_LENGTH).toLowerCase();
  }
  // Not a sha, but not nothing either: "DEV" from the local dev server, or
  // the "desktop" placeholder an Electron shell predating OPE-358 injects.
  // Both say strictly more than the version placeholder does.
  if (commit !== "") return commit;
  // Unreachable in a live client -- ClientEnv.get() throws long before this
  // if BOOTSTRAP_CONFIG is absent -- but the label must never come back
  // blank, so fall back to whatever the file held.
  return withV;
}

/**
 * composeGameVersion applied to this page.
 *
 * Called at render time rather than evaluated at module scope: the commit
 * comes from BOOTSTRAP_CONFIG, which the server injects into the page, and
 * which is not guaranteed to exist when this module is first imported.
 */
export function currentGameVersion(): string {
  return composeGameVersion(version, currentGitCommit());
}

/**
 * The version alone, never a commit (OPE-387).
 *
 * The nav bar showed this under the logo until 2026-10-08; it now shows the
 * title alone, and the footer is the one place naming the build. Kept as the
 * footer's "what version is this" half, where a sha would still read as a
 * broken label to a player who is not debugging a build.
 */
export function taggedGameVersion(rawVersion: string): string {
  return withVersionPrefix(rawVersion.trim());
}

function withVersionPrefix(trimmed: string): string {
  return /^[vV]/.test(trimmed) ? trimmed : `v${trimmed}`;
}

// ClientEnv.get() throws when BOOTSTRAP_CONFIG is missing. A cosmetic version
// label must never be the thing that takes the page down, so read it
// defensively and let composeGameVersion treat "" as "no commit known".
function currentGitCommit(): string {
  try {
    return ClientEnv.gitCommit();
  } catch {
    return "";
  }
}
