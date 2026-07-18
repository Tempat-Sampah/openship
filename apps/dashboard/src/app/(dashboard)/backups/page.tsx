"use client";

import React, { useCallback, useEffect, useState } from "react";
import {
  Plus,
  RefreshCw,
  Trash2,
  CheckCircle2,
  AlertCircle,
  Cloud,
  HardDrive,
  Server,
  Loader2,
  Pencil,
  Star,
  KeyRound,
} from "lucide-react";
import {
  backupDestinationsApi,
  type BackupDestinationSummary,
  getApiErrorMessage,
} from "@/lib/api";
import { PageContainer } from "@/components/ui/PageContainer";
import { Modal } from "@/components/ui/Modal";
import DropdownMenu, { type MenuAction } from "@/components/ui/DropdownMenu";
import { useToast } from "@/context/ToastContext";
import { useI18n, interpolate } from "@/components/i18n-provider";
import { CreateDestinationModal } from "./_components/CreateDestinationModal";

const KIND_ICONS: Record<
  BackupDestinationSummary["kind"],
  React.ComponentType<{ className?: string }>
> = {
  s3_compatible: Cloud,
  sftp: Server,
  openship_server: Server,
  local: HardDrive,
  http_upload: Cloud,
};

// Kinds the create/edit form can configure. Others (e.g. http_upload) may exist
// via the API but must NOT offer "Edit" — the form has no UI for them and would
// drop into the create picker, risking a wrong-kind overwrite.
const EDITABLE_KINDS = new Set<BackupDestinationSummary["kind"]>([
  "s3_compatible",
  "sftp",
  "openship_server",
  "local",
]);

export default function BackupsPage() {
  const { showToast } = useToast();
  const { t } = useI18n();
  const m = t.misc.backups;
  const kindLabels: Record<BackupDestinationSummary["kind"], string> = {
    s3_compatible: m.kindS3,
    sftp: m.kindSftp,
    openship_server: m.kindServer,
    local: m.kindLocal,
    http_upload: m.kindHttp,
  };
  const [items, setItems] = useState<BackupDestinationSummary[]>([]);
  const [loading, setLoading] = useState(true);
  const [modalOpen, setModalOpen] = useState(false);
  const [editing, setEditing] = useState<BackupDestinationSummary | null>(null);
  const [verifyingIds, setVerifyingIds] = useState<Set<string>>(new Set());
  const [deleting, setDeleting] = useState<BackupDestinationSummary | null>(null);
  const [deleteBusy, setDeleteBusy] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await backupDestinationsApi.list();
      setItems(res.data);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const handleVerify = useCallback(
    async (row: BackupDestinationSummary) => {
      setVerifyingIds((prev) => new Set(prev).add(row.id));
      try {
        const res = await backupDestinationsApi.preflight(row.id);
        if (res.data.ok) {
          showToast(interpolate(m.verifiedSuccess, { name: row.name }), "success", m.title);
        } else {
          showToast(res.data.reason ?? m.verificationFailedMsg, "error", m.verificationFailedTitle);
        }
      } catch (err) {
        showToast(getApiErrorMessage(err, m.verificationFailedTitle), "error", m.verificationFailedTitle);
      } finally {
        setVerifyingIds((prev) => {
          const next = new Set(prev);
          next.delete(row.id);
          return next;
        });
        void load();
      }
    },
    [load, showToast, m],
  );

  const handleSetDefault = useCallback(
    async (row: BackupDestinationSummary) => {
      try {
        await backupDestinationsApi.update(row.id, { isDefault: true });
        showToast(interpolate(m.setDefaultSuccess, { name: row.name }), "success", m.title);
        await load();
      } catch (err) {
        showToast(getApiErrorMessage(err, m.setDefaultFailed), "error", m.title);
      }
    },
    [load, showToast, m],
  );

  const confirmDelete = useCallback(async () => {
    if (!deleting) return;
    setDeleteBusy(true);
    try {
      await backupDestinationsApi.delete(deleting.id);
      showToast(interpolate(m.deletedSuccess, { name: deleting.name }), "success", m.title);
      setDeleting(null);
      await load();
    } catch (err) {
      showToast(getApiErrorMessage(err, m.deleteFailed), "error", m.title);
    } finally {
      setDeleteBusy(false);
    }
  }, [deleting, load, showToast, m]);

  return (
    <PageContainer>
      {/* ── Header ──────────────────────────────────────────── */}
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1
            className="text-2xl font-medium text-foreground/80"
            style={{ letterSpacing: "-0.2px" }}
          >
            {m.title}
          </h1>
          <p className="text-sm text-muted-foreground/70 mt-1">
            {m.subtitle}
          </p>
        </div>
        {items.length > 0 && (
          <button
            onClick={() => setModalOpen(true)}
            className="inline-flex items-center gap-2 px-4 py-2.5 bg-primary text-primary-foreground text-sm font-medium rounded-xl hover:bg-primary/90 transition-all hover:shadow-lg hover:shadow-primary/25"
          >
            <Plus className="size-4" />
            {m.addDestination}
          </button>
        )}
      </div>

      {loading && items.length === 0 ? (
        <div className="flex items-center justify-center py-20">
          <Loader2 className="size-5 animate-spin text-muted-foreground" />
        </div>
      ) : items.length === 0 ? (
        <EmptyState onAdd={() => setModalOpen(true)} />
      ) : (
        <div className="bg-card rounded-2xl border border-border/50 overflow-hidden">
          <ul className="divide-y divide-border/50">
            {items.map((row) => {
              const Icon = KIND_ICONS[row.kind] ?? Cloud;
              const actions: MenuAction[] = [];
              if (EDITABLE_KINDS.has(row.kind)) {
                actions.push({
                  id: "edit",
                  label: m.editAction,
                  icon: <Pencil className="size-4" />,
                  onClick: () => setEditing(row),
                });
              }
              if (!row.isDefault) {
                actions.push({
                  id: "default",
                  label: m.setDefaultAction,
                  icon: <Star className="size-4" />,
                  onClick: () => handleSetDefault(row),
                });
              }
              if (actions.length > 0) actions.push({ id: "div", divider: true });
              actions.push({
                id: "delete",
                label: m.deleteAction,
                icon: <Trash2 className="size-4" />,
                variant: "danger",
                onClick: () => setDeleting(row),
              });
              return (
                <li
                  key={row.id}
                  className="flex items-start justify-between gap-4 px-6 py-4 transition-colors hover:bg-foreground/[0.02]"
                >
                  <div className="flex min-w-0 flex-1 items-start gap-3">
                    <div className="mt-0.5 flex size-10 shrink-0 items-center justify-center rounded-xl bg-foreground/[0.05] border border-border/40">
                      <Icon className="size-4 text-foreground/70" />
                    </div>
                    <div className="min-w-0 flex-1">
                      <div className="flex flex-wrap items-center gap-2">
                        <p className="truncate text-sm font-medium text-foreground">
                          {row.name}
                        </p>
                        {row.isDefault && (
                          <span
                            className="inline-flex items-center gap-1 rounded-full bg-primary/10 px-2 py-0.5 text-[11px] font-medium text-primary"
                            title={m.defaultTitle}
                          >
                            <Star className="size-3 fill-current" />
                            {m.defaultBadge}
                          </span>
                        )}
                        <span className="rounded-full bg-foreground/[0.06] px-2 py-0.5 text-[11px] font-medium text-muted-foreground">
                          {kindLabels[row.kind]}
                        </span>
                        {verifyingIds.has(row.id) ? (
                          <span className="inline-flex items-center gap-1 rounded-full bg-foreground/[0.06] px-2 py-0.5 text-[11px] font-medium text-muted-foreground">
                            <Loader2 className="size-3 animate-spin" />
                            {m.verifyingBadge}
                          </span>
                        ) : row.lastVerifiedAt ? (
                          <span
                            className="inline-flex items-center gap-1 rounded-full bg-emerald-500/10 px-2 py-0.5 text-[11px] font-medium text-emerald-600 dark:text-emerald-400"
                            title={interpolate(m.lastVerified, { date: new Date(row.lastVerifiedAt).toLocaleString() })}
                          >
                            <CheckCircle2 className="size-3" />
                            {m.verifiedBadge}
                          </span>
                        ) : row.lastVerifyError ? (
                          <span
                            className="inline-flex items-center gap-1 rounded-full bg-red-500/10 px-2 py-0.5 text-[11px] font-medium text-red-600 dark:text-red-400"
                            title={row.lastVerifyError}
                          >
                            <AlertCircle className="size-3" />
                            {m.failedBadge}
                          </span>
                        ) : (
                          <span className="rounded-full bg-foreground/[0.04] px-2 py-0.5 text-[11px] font-medium text-muted-foreground/70">
                            {m.notVerifiedBadge}
                          </span>
                        )}
                      </div>
                      <p className="mt-1 truncate font-mono text-xs text-muted-foreground/80">
                        {describeDestination(row, m)}
                      </p>
                      <p className="mt-1 inline-flex items-center gap-1 text-[11px] text-muted-foreground/60">
                        <KeyRound className="size-3" />
                        {describeCredentials(row, m)}
                        {row.lastVerifyError && !row.lastVerifiedAt && (
                          <span className="ms-1 truncate text-red-500/80" title={row.lastVerifyError}>
                            · {row.lastVerifyError}
                          </span>
                        )}
                      </p>
                    </div>
                  </div>
                  <div className="flex shrink-0 items-center gap-1">
                    <button
                      onClick={() => handleVerify(row)}
                      disabled={verifyingIds.has(row.id)}
                      className="rounded-lg p-2 text-muted-foreground transition-colors hover:bg-foreground/[0.06] hover:text-foreground disabled:opacity-50"
                      title={m.verifyConnection}
                    >
                      {verifyingIds.has(row.id) ? (
                        <Loader2 className="size-4 animate-spin" />
                      ) : (
                        <RefreshCw className="size-4" />
                      )}
                    </button>
                    <DropdownMenu align="right" actions={actions} />
                  </div>
                </li>
              );
            })}
          </ul>
        </div>
      )}

      <CreateDestinationModal
        isOpen={modalOpen || !!editing}
        destination={editing}
        onClose={() => {
          setModalOpen(false);
          setEditing(null);
        }}
        onSaved={async () => {
          const wasEdit = !!editing;
          setModalOpen(false);
          setEditing(null);
          showToast(
            wasEdit ? m.updated : m.created,
            "success",
            m.title,
          );
          await load();
        }}
      />

      {/* Delete confirmation */}
      {deleting && (
        <Modal
          isOpen
          onClose={() => !deleteBusy && setDeleting(null)}
          maxWidth="440px"
          width="100%"
        >
          <div className="p-6">
            <div className="flex items-start gap-3">
              <div className="mt-0.5 flex size-10 shrink-0 items-center justify-center rounded-xl bg-red-500/10">
                <Trash2 className="size-5 text-red-500" />
              </div>
              <div className="min-w-0">
                <h2 className="text-base font-semibold text-foreground">
                  {m.deleteTitle}
                </h2>
                <p className="mt-1 text-sm text-muted-foreground">
                  {m.deletePre}
                  <span className="font-medium text-foreground">{deleting.name}</span>
                  {m.deletePost}
                </p>
              </div>
            </div>
            <div className="mt-6 flex items-center justify-end gap-3">
              <button
                onClick={() => setDeleting(null)}
                disabled={deleteBusy}
                className="h-10 inline-flex items-center rounded-xl px-4 text-sm font-medium text-muted-foreground transition-colors hover:bg-foreground/[0.06] hover:text-foreground disabled:opacity-50"
              >
                {m.cancel}
              </button>
              <button
                onClick={confirmDelete}
                disabled={deleteBusy}
                className="h-10 inline-flex items-center gap-2 rounded-xl bg-red-500 px-5 text-sm font-medium text-white transition-colors hover:bg-red-600 disabled:opacity-50"
              >
                {deleteBusy ? (
                  <Loader2 className="size-4 animate-spin" />
                ) : (
                  <Trash2 className="size-4" />
                )}
                {m.deleteAction}
              </button>
            </div>
          </div>
        </Modal>
      )}
    </PageContainer>
  );
}

function EmptyState({ onAdd }: { onAdd: () => void }) {
  const { t } = useI18n();
  const m = t.misc.backups;
  return (
    <div className="py-16 text-center">
      {/* SVG illustration — backup-themed: stacked databases being archived to a cloud */}
      <div className="relative mx-auto w-64 h-44 mb-8">
        <svg
          className="absolute inset-0 w-full h-full"
          viewBox="0 0 260 180"
          fill="none"
        >
          {/* Stacked database cylinders (the source) — three layers, like archive depth */}
          {/* Bottom cylinder */}
          <path
            d="M40 122v12c0 5.5 12.5 10 28 10s28-4.5 28-10v-12"
            fill="var(--th-sf-04)"
            stroke="var(--th-bd-subtle)"
            strokeWidth="1"
          />
          <ellipse
            cx="68"
            cy="122"
            rx="28"
            ry="6"
            fill="var(--th-sf-05)"
            stroke="var(--th-bd-subtle)"
            strokeWidth="1"
          />

          {/* Middle cylinder */}
          <path
            d="M40 96v18c0 5.5 12.5 10 28 10s28-4.5 28-10V96"
            fill="var(--th-sf-03)"
            stroke="var(--th-bd-default)"
            strokeWidth="1"
          />
          <ellipse
            cx="68"
            cy="96"
            rx="28"
            ry="6"
            fill="var(--th-sf-05)"
            stroke="var(--th-bd-default)"
            strokeWidth="1"
          />

          {/* Top cylinder */}
          <path
            d="M40 70v18c0 5.5 12.5 10 28 10s28-4.5 28-10V70"
            fill="var(--th-card-bg)"
            stroke="var(--th-bd-default)"
            strokeWidth="1"
          />
          <ellipse
            cx="68"
            cy="70"
            rx="28"
            ry="6"
            fill="var(--th-card-bg)"
            stroke="var(--th-bd-default)"
            strokeWidth="1"
          />

          {/* Activity indicator dots on the top cylinder — colored like traffic lights */}
          <circle cx="55" cy="70" r="2.5" fill="#22c55e" fillOpacity="0.7" />
          <circle cx="63" cy="70" r="2.5" fill="#eab308" fillOpacity="0.5" />
          <circle cx="71" cy="70" r="2.5" fill="var(--th-on-12)" />

          {/* Arrow from databases to cloud — animated-looking dashed flow */}
          <path
            d="M105 95 Q 130 80 155 88"
            stroke="var(--th-on-20)"
            strokeWidth="2"
            strokeDasharray="4 4"
            strokeLinecap="round"
            fill="none"
          />
          <path
            d="M150 84 L 156 88 L 152 94"
            stroke="var(--th-on-30)"
            strokeWidth="2"
            strokeLinecap="round"
            strokeLinejoin="round"
            fill="none"
          />

          {/* Destination cloud (the backup target) */}
          <path
            d="M175 82
               c -6 0 -11 4 -12 9
               c -5 0 -9 4 -9 9
               c 0 5 4 9 9 9
               h 44
               c 6 0 11 -4 11 -10
               c 0 -5 -4 -10 -10 -10
               c -1 -6 -7 -11 -14 -11
               c -8 0 -15 5 -19 4z"
            fill="var(--th-card-bg)"
            stroke="var(--th-bd-default)"
            strokeWidth="1.5"
          />

          {/* Checkmark inside the cloud — backup verified */}
          <path
            d="M188 100 l 4 4 l 9 -9"
            stroke="#22c55e"
            strokeOpacity="0.8"
            strokeWidth="2.5"
            strokeLinecap="round"
            strokeLinejoin="round"
            fill="none"
          />

          {/* Decorative dots — same vocabulary as other empty states */}
          <circle cx="25" cy="55" r="4" fill="var(--th-on-10)" />
          <circle cx="35" cy="155" r="6" fill="var(--th-on-08)" />
          <circle cx="240" cy="50" r="3" fill="var(--th-on-12)" />
          <circle cx="245" cy="138" r="5" fill="var(--th-on-06)" />

          {/* Sparkle accents */}
          <path d="M15 100l2-4 2 4-4-2 4 0-4 2z" fill="var(--th-on-16)" />
          <path d="M230 150l1.5-3 1.5 3-3-1.5 3 0-3 1.5z" fill="var(--th-on-12)" />
        </svg>
      </div>

      <h3
        className="text-2xl font-medium text-foreground/80 mb-2"
        style={{ letterSpacing: "-0.2px" }}
      >
        {m.emptyTitle}
      </h3>
      <p className="text-sm text-muted-foreground/70 max-w-sm mx-auto mb-8 leading-relaxed">
        {m.emptyDescription}
      </p>

      <div className="flex flex-col sm:flex-row items-center justify-center gap-3 mb-10">
        <button
          onClick={onAdd}
          className="inline-flex items-center gap-2 px-6 py-3 bg-primary text-primary-foreground text-sm font-medium rounded-xl hover:bg-primary/90 transition-all hover:shadow-lg hover:shadow-primary/25 hover:-translate-y-0.5"
        >
          <Plus className="size-4" />
          {m.addFirst}
        </button>
      </div>

      {/* Feature highlight cards — exact home empty-state pattern */}
      <div className="max-w-2xl mx-auto">
        <p className="text-xs text-muted-foreground/60 uppercase tracking-wider mb-4">
          {m.supportedTitle}
        </p>
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
          <KindCard icon={Cloud} label={m.kindS3} sub={m.cardS3Sub} />
          <KindCard icon={Server} label={m.kindSftp} sub={m.cardSftpSub} />
          <KindCard icon={Server} label={m.kindServer} sub={m.cardServerSub} />
          <KindCard icon={HardDrive} label={m.kindLocal} sub={m.cardLocalSub} />
        </div>
      </div>
    </div>
  );
}

function KindCard({
  icon: Icon,
  label,
  sub,
}: {
  icon: React.ComponentType<{ className?: string }>;
  label: string;
  sub: string;
}) {
  return (
    <div className="bg-card border border-border/50 rounded-xl p-4 text-start">
      <div className="w-8 h-8 rounded-lg bg-muted flex items-center justify-center mb-3">
        <Icon className="size-4 text-muted-foreground" />
      </div>
      <p className="text-sm font-medium text-foreground">{label}</p>
      <p className="text-xs text-muted-foreground mt-0.5">{sub}</p>
    </div>
  );
}

function describeCredentials(
  row: BackupDestinationSummary,
  m: Record<string, string>,
): string {
  switch (row.kind) {
    case "s3_compatible":
      return row.hasAccessKeyId && row.hasSecretAccessKey
        ? m.credAccessKeyStored
        : m.credNone;
    case "sftp":
      return row.hasSftpPrivateKey
        ? m.credPrivateKeyStored
        : row.hasSftpPassword
          ? m.credPasswordStored
          : m.credNone;
    case "openship_server":
      return m.credReusesServer;
    case "local":
      return m.credNoneNeeded;
    case "http_upload":
      return "—";
  }
}

function describeDestination(
  row: BackupDestinationSummary,
  m: Record<string, string>,
): string {
  switch (row.kind) {
    case "s3_compatible":
      return `${row.bucket ?? "?"}${row.region ? ` · ${row.region}` : ""}${row.endpoint ? ` · ${row.endpoint}` : ""}`;
    case "sftp":
      return `${row.sshUser ?? "?"}@${row.sshHost ?? "?"}:${row.sshPort ?? 22}${row.pathPrefix ? `:${row.pathPrefix}` : ""}`;
    case "openship_server":
      return `${m.serverPrefix}${row.serverId?.slice(0, 8) ?? "?"}…${row.pathPrefix ? ` · ${row.pathPrefix}` : ""}`;
    case "local":
      return row.endpoint ?? "?";
    case "http_upload":
      return row.endpoint ?? "?";
  }
}
