"use client";

/**
 * Update + advisory state for the dashboard (desktop AND self-hosted).
 *
 * Everything is PULLED from the public GitHub repo — the latest release + an
 * advisory manifest pinned to that release's tag (so unreleased commits to main
 * never reach clients). Nothing is pushed to the app. Pure resolution lives in
 * @repo/core; this hook only does I/O + persistence.
 */

import { useCallback, useEffect, useState } from "react";
import {
  RELEASES_LATEST_API,
  advisoryManifestUrl,
  parseManifest,
  resolveUpdateState,
  compareSemver,
  type AdvisoryManifest,
  type LatestRelease,
  type UpdateState,
} from "@repo/core";
import { useDeploymentInfo } from "@/hooks/useDeploymentInfo";

const LS_MUTED = "openship_update_muted";
const LS_DISMISSED = "openship_dismissed_advisories";
const LS_LAST_SEEN = "openship_last_seen_version";

function isDesktop(): boolean {
  return typeof window !== "undefined" && !!window.desktop?.isDesktop;
}

interface Prefs {
  muted: boolean;
  dismissed: string[];
  lastSeen: string | null;
}

/** Prefs live in the desktop config store (native app) or localStorage (web). */
async function getPrefs(): Promise<Prefs> {
  const cfg = isDesktop() ? window.desktop?.config : undefined;
  if (cfg) {
    const notif = await cfg.get<boolean | undefined>("updateNotifications").catch(() => undefined);
    const dismissed = (await cfg.get<string[] | undefined>("dismissedAdvisoryIds").catch(() => undefined)) ?? [];
    const lastSeen = (await cfg.get<string | undefined>("lastSeenVersion").catch(() => undefined)) ?? null;
    return { muted: notif === false, dismissed, lastSeen };
  }
  let dismissed: string[] = [];
  try {
    dismissed = JSON.parse(localStorage.getItem(LS_DISMISSED) ?? "[]");
  } catch {
    dismissed = [];
  }
  return {
    muted: localStorage.getItem(LS_MUTED) === "1",
    dismissed,
    lastSeen: localStorage.getItem(LS_LAST_SEEN),
  };
}

async function persistMuted(muted: boolean): Promise<void> {
  const cfg = isDesktop() ? window.desktop?.config : undefined;
  if (cfg) await cfg.set("updateNotifications", !muted);
  else localStorage.setItem(LS_MUTED, muted ? "1" : "0");
}

async function persistDismissed(id: string): Promise<void> {
  const cfg = isDesktop() ? window.desktop?.config : undefined;
  if (cfg) {
    const cur = (await cfg.get<string[] | undefined>("dismissedAdvisoryIds").catch(() => undefined)) ?? [];
    if (!cur.includes(id)) await cfg.set("dismissedAdvisoryIds", [...cur, id]);
    return;
  }
  let cur: string[] = [];
  try {
    cur = JSON.parse(localStorage.getItem(LS_DISMISSED) ?? "[]");
  } catch {
    cur = [];
  }
  if (!cur.includes(id)) localStorage.setItem(LS_DISMISSED, JSON.stringify([...cur, id]));
}

async function persistLastSeen(version: string): Promise<void> {
  const cfg = isDesktop() ? window.desktop?.config : undefined;
  if (cfg) await cfg.set("lastSeenVersion", version);
  else localStorage.setItem(LS_LAST_SEEN, version);
}

// Session-scoped cache: fetch GitHub once per app session (GitHub rate-limits
// unauthenticated calls to 60/hr/IP; navigation shouldn't re-hit it).
let remoteCache: Promise<{ latest: LatestRelease | null; manifest: AdvisoryManifest | null }> | null = null;

async function fetchRemote(): Promise<{ latest: LatestRelease | null; manifest: AdvisoryManifest | null }> {
  remoteCache ??= (async () => {
    let latest: LatestRelease | null = null;
    let manifest: AdvisoryManifest | null = null;
    try {
      const res = await fetch(RELEASES_LATEST_API, {
        headers: { Accept: "application/vnd.github+json" },
      });
      if (res.ok) {
        const data = (await res.json()) as { tag_name?: string; body?: string };
        const tag = data.tag_name ?? "";
        if (tag) {
          latest = { version: tag.replace(/^v/, ""), tag, notes: data.body ?? "" };
          // Advisories pinned to the release TAG — main commits never surface.
          try {
            const m = await fetch(advisoryManifestUrl(tag), { headers: { Accept: "application/json" } });
            if (m.ok) manifest = parseManifest(await m.json());
          } catch {
            /* no manifest at this tag → no advisories */
          }
        }
      }
    } catch {
      /* offline / rate-limited → no update info */
    }
    return { latest, manifest };
  })();
  return remoteCache;
}

export interface UseUpdates {
  state: UpdateState | null;
  latest: LatestRelease | null;
  muted: boolean;
  desktop: boolean;
  /** The version to celebrate in a "what's new" notice, or null. */
  whatsNewVersion: string | null;
  dismissAdvisory: (id: string) => void;
  dismissWhatsNew: () => void;
  setMuted: (muted: boolean) => void;
  /** Desktop: open the native updater window for the pending update. */
  startDesktopUpdate: () => void;
  reload: () => void;
  /** Force a fresh GitHub check, bypassing the session cache. */
  refresh: () => void;
}

export function useUpdates(): UseUpdates {
  const deployInfo = useDeploymentInfo();
  const [state, setState] = useState<UpdateState | null>(null);
  const [latest, setLatest] = useState<LatestRelease | null>(null);
  const [muted, setMutedState] = useState(false);
  const [currentVersion, setCurrentVersion] = useState<string | null>(null);
  const [whatsNewVersion, setWhatsNewVersion] = useState<string | null>(null);

  const load = useCallback(async () => {
    // Only desktop + self-hosted operators control their own install. On the
    // managed SaaS (cloud) there's nothing to update, so never show any of this.
    const enabled = isDesktop() || deployInfo?.selfHosted === true;
    if (!enabled) return;

    let current: string | null = null;
    if (isDesktop() && window.desktop?.app) {
      current = await window.desktop.app.version().catch(() => null);
    } else {
      current = deployInfo?.version ?? null;
    }
    if (!current) return;
    setCurrentVersion(current);

    const [prefs, remote] = await Promise.all([getPrefs(), fetchRemote()]);
    setMutedState(prefs.muted);
    setLatest(remote.latest);
    setState(
      resolveUpdateState({
        currentVersion: current,
        latestRelease: remote.latest,
        manifest: remote.manifest,
        dismissed: prefs.dismissed,
        muted: prefs.muted,
      }),
    );

    // "What's new": show once when the running version is newer than the last
    // version we announced. First run (no record) just seeds the baseline.
    if (prefs.lastSeen === null) {
      await persistLastSeen(current);
    } else if (compareSemver(current, prefs.lastSeen) > 0) {
      setWhatsNewVersion(current);
    }
  }, [deployInfo?.version, deployInfo?.selfHosted]);

  useEffect(() => {
    void load();
  }, [load]);

  const dismissAdvisory = useCallback(
    (id: string) => {
      const adv = state?.advisories.find((a) => a.id === id);
      setState((s) => (s ? { ...s, advisories: s.advisories.filter((a) => a.id !== id) } : s));
      // Critical advisories are session-dismiss only (they resurface next launch
      // by design); everything else is remembered so it never nags again.
      if (adv && adv.severity !== "critical") void persistDismissed(id);
    },
    [state],
  );

  const dismissWhatsNew = useCallback(() => {
    if (currentVersion) void persistLastSeen(currentVersion);
    setWhatsNewVersion(null);
  }, [currentVersion]);

  const setMuted = useCallback(
    (m: boolean) => {
      setMutedState(m);
      void persistMuted(m).then(() => load());
    },
    [load],
  );

  const startDesktopUpdate = useCallback(() => {
    void window.desktop?.updates?.open?.();
  }, []);

  // Force a fresh GitHub check (the session cache is otherwise reused).
  const refresh = useCallback(() => {
    remoteCache = null;
    void load();
  }, [load]);

  return {
    state,
    latest,
    muted,
    desktop: isDesktop(),
    whatsNewVersion,
    dismissAdvisory,
    dismissWhatsNew,
    setMuted,
    startDesktopUpdate,
    reload: load,
    refresh,
  };
}
