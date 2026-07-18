import { cacheStore } from "./cache-store";

/**
 * "Armed" Oblien edge ownership-challenge tokens.
 *
 * During the edge target-verification handshake we ask Oblien for a one-time
 * token, then serve it at `/.well-known/oblien-proxy-challenge/<token>` so
 * Oblien's probe (issued synchronously by `checkVerification`) sees HTTP 200
 * with the exact token. A token is only served while armed — a short window
 * around the check — so the endpoint can't be used to enumerate or replay.
 *
 * Backed by the shared cacheStore (in-memory on self-hosted, Redis on the SaaS)
 * so it matches the rest of the codebase's ephemeral-state pattern and works
 * across the SaaS's multiple workers.
 */

const NS = "oblien-edge-challenge";
const TTL_SECONDS = 10 * 60;

export async function armEdgeChallenge(token: string): Promise<void> {
  if (!token) return;
  const store = await cacheStore<boolean>(NS, { maxSize: 512 });
  await store.set(token, true, TTL_SECONDS);
}

export async function disarmEdgeChallenge(token: string): Promise<void> {
  if (!token) return;
  const store = await cacheStore<boolean>(NS, { maxSize: 512 });
  await store.delete(token);
}

/** True while `token` should be served (present + unexpired). */
export async function isEdgeChallengeArmed(token: string): Promise<boolean> {
  if (!token) return false;
  const store = await cacheStore<boolean>(NS, { maxSize: 512 });
  return (await store.get(token)) === true;
}
