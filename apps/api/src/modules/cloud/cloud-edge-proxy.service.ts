/**
 * Cloud edge proxy service - sync a namespaced edge proxy on Oblien.
 *
 * Extracted from cloud-saas.controller so slug normalization +
 * hostname construction stay in one place and are unit-testable
 * independent of the HTTP layer.
 */

import { SYSTEM } from "@repo/core";
import { getNamespaceClient } from "../../lib/openship-cloud";

/**
 * Normalize a target to a single canonical `https://<host[:port][/path]>` form.
 *
 * Two reasons this is forced to https, not "preserve what's given":
 *  - Oblien keys verification per EXACT target string and probes/proxies with
 *    redirects disabled. Our origins force http→https on :80, so an `http://`
 *    target always fails the check — and this service only ever handles the
 *    managed free-domain edge, whose origin is the :443 OpenResty edge.
 *  - Verification and create MUST use the identical string; normalizing in one
 *    place (used by request/check/create alike) guarantees that.
 */
export function normalizeEdgeTarget(target: string): string {
  const hostPart = target.trim().replace(/^https?:\/\//i, "");
  return `https://${hostPart}`;
}

export async function syncCloudEdgeProxy(
  organizationId: string,
  input: { slug: string; target: string },
): Promise<{ ok: true; hostname: string } | { ok: false; status: 400; error: string }> {
  const slug = input.slug
    .toLowerCase()
    .replace(/[^a-z0-9-]+/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "");
  if (!slug) {
    return { ok: false, status: 400, error: "Invalid slug" };
  }

  const baseDomain = SYSTEM.DOMAINS.CLOUD_DOMAIN;
  const hostname = `${slug}.${baseDomain}`;
  const target = normalizeEdgeTarget(input.target);

  const { client, namespace } = await getNamespaceClient(organizationId);

  // Namespace isolation: Oblien scopes edgeProxy.list/update/enable to
  // the namespace token's owner, so the look-up-by-slug + mutate path
  // can't cross orgs. The `create` call additionally passes `namespace`
  // explicitly so Oblien validates the new resource lands in the
  // expected namespace — non-create methods (list/update/enable/disable
  // /delete) identify by id and don't accept a namespace param.
  const { proxies } = await client.edgeProxy.list();
  const existing = proxies.find((p) => p.slug === slug);

  if (!existing) {
    await client.edgeProxy.create({ name: hostname, slug, domain: baseDomain, target, namespace });
  } else {
    if (
      existing.name !== hostname ||
      existing.slug !== slug ||
      existing.target !== target
    ) {
      await client.edgeProxy.update(existing.id, { name: hostname, slug, target });
    }
    if (existing.status === "disabled") {
      await client.edgeProxy.enable(existing.id);
    }
  }

  return { ok: true, hostname };
}

/**
 * Step 1 of the ownership handshake: ask Oblien for a challenge to prove control
 * of `target`. Returns the token + path the caller must serve (HTTP 200, exact
 * body) at `https://<host><path>` before {@link checkTargetVerification}.
 * Normalizes the target identically to create so the records line up.
 */
export async function requestTargetVerification(
  organizationId: string,
  rawTarget: string,
): Promise<{ id: number; token: string; path: string; target: string }> {
  const target = normalizeEdgeTarget(rawTarget);
  const { client } = await getNamespaceClient(organizationId);
  const { verification } = await client.edgeProxy.requestVerification(target);
  return { id: verification.id, token: verification.token, path: verification.path, target };
}

/**
 * Step 2: tell Oblien to probe the served token. On success the target is
 * verified for ~90 days (per user+target), reusable across every slug to it.
 */
export async function checkTargetVerification(
  organizationId: string,
  verificationId: number,
): Promise<{ status: string; error?: string }> {
  const { client } = await getNamespaceClient(organizationId);
  const { verification } = await client.edgeProxy.checkVerification(verificationId);
  return { status: verification.status, error: verification.error };
}
