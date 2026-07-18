/**
 * Update & advisory types, shared by the desktop app and the dashboard.
 *
 * Advisories are pulled from the repo, but PINNED TO THE LATEST RELEASE TAG
 * (see `advisoryManifestUrl`) — never from `main` — so a push to main with no
 * new version can't change what any client sees. Clients only ever PULL from
 * the public GitHub repo; nothing pushes to them.
 */

export type AdvisorySeverity = "critical" | "recommended" | "info";

export interface AdvisoryAction {
  label: string;
  /** "update" → drive the in-app updater; "open-url" → open `url` externally. */
  kind: "update" | "open-url";
  url?: string;
}

export interface Advisory {
  /** Stable id — used for per-advisory dismissal. */
  id: string;
  severity: AdvisorySeverity;
  /** Version range this targets, e.g. "<=0.1.8" or ">=0.1.0 <0.1.9". */
  affects: string;
  title: string;
  message: string;
  action?: AdvisoryAction;
}

export interface AdvisoryManifest {
  advisories: Advisory[];
}

export interface LatestRelease {
  /** Version without a leading "v", e.g. "0.1.9". */
  version: string;
  /** Raw tag, e.g. "v0.1.9". */
  tag: string;
  /** Release notes (markdown/plain) from the GitHub release body. */
  notes: string;
}

export interface UpdateState {
  currentVersion: string;
  latestVersion: string | null;
  updateAvailable: boolean;
  /** Advisories that apply to the current version, most severe first. */
  advisories: Advisory[];
  /** Link to all releases. */
  changelogUrl: string;
  /** Link to the latest release's notes (tag-specific), or all releases. */
  latestChangelogUrl: string;
}

export const GITHUB_REPO = "oblien/openship";

/** GitHub API: the latest published (non-prerelease) release. */
export const RELEASES_LATEST_API = `https://api.github.com/repos/${GITHUB_REPO}/releases/latest`;

/**
 * Raw advisory manifest URL, PINNED to a release tag. Because it's pinned to a
 * tag (not a branch), it only changes when a version is released — commits to
 * `main` are invisible to clients. Returns null for an empty tag.
 */
export function advisoryManifestUrl(tag: string): string {
  return `https://raw.githubusercontent.com/${GITHUB_REPO}/${encodeURIComponent(tag)}/release-advisories.json`;
}

/** Human-facing changelog link — a specific tag's notes, or all releases. */
export function changelogUrl(tag?: string): string {
  return tag
    ? `https://github.com/${GITHUB_REPO}/releases/tag/${encodeURIComponent(tag)}`
    : `https://github.com/${GITHUB_REPO}/releases`;
}
