"use client";

import { useState, useEffect, useCallback } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import {
  ArrowLeft,
  CheckCircle2,
  XCircle,
  Loader2,
  Settings2,
  Trash2,
  LayoutGrid,
  Blocks,
  Terminal,
  MoreHorizontal,
  Server,
  Globe,
  User,
  KeyRound,
  Shield,
  Network,
} from "lucide-react";
import { ApiError, getApiErrorMessage, isAbortError, systemApi } from "@/lib/api";
import { useToast } from "@/context/ToastContext";
import { useModal } from "@/context/ModalContext";
import { useI18n, interpolate } from "@/components/i18n-provider";
import { PageContainer } from "@/components/ui/PageContainer";
import { useSetupStream } from "@/hooks/useSetupStream";
import { useMonitorStream } from "@/hooks/useMonitorStream";
import type { ServerInfo, ComponentStatus, SetupComponentProgress, SetupLogEvent } from "@/lib/api/system";
import { ServerForm } from "../_components/server-form";
import { OverviewTab } from "./_components/overview-tab";
import { ComponentsTab } from "./_components/components-tab";
import { TerminalTab } from "./_components/terminal-tab";
import {
  ConnectionBanner,
  classifyConnectionError,
  type ConnectionErrorKind,
} from "./_components/connection-banner";

import { RateLimitSettings } from "./_components/rate-limit-settings";
import { PortForwardingCard } from "./_components/port-forwarding-card";
import { usePlatform } from "@/context/PlatformContext";

type Tab = "overview" | "components" | "security" | "ports" | "terminal";
type ManualActionMode = "remove" | null;

interface TabDef {
  key: Tab;
  icon: React.ElementType;
  /** Desktop-only tabs are filtered out in non-desktop deployments. */
  desktopOnly?: boolean;
}

// Mail management lives in /emails - that page picks any server and reads
// its mail-install state at runtime. We don't repeat that UI here.
const TABS: TabDef[] = [
  { key: "overview",   icon: LayoutGrid },
  { key: "components", icon: Blocks },
  { key: "security",   icon: Shield },
  // Port forwarding is meaningful only in desktop mode (the orchestrator IS
  // the user's machine); hidden elsewhere.
  { key: "ports",      icon: Network, desktopOnly: true },
  { key: "terminal",   icon: Terminal },
];

export default function ServerDetailPage({
  params,
}: {
  params: Promise<{ serverId: string }>;
}) {
  const router = useRouter();
  const searchParams = useSearchParams();
  const editing = searchParams.get("edit") === "true";
  const { showToast } = useToast();
  const { showModal, hideModal } = useModal();
  const { t } = useI18n();
  // Port forwarding is meaningful only in desktop mode (the orchestrator IS
  // the user's machine). Backend routes are independently gated by assertDesktop.
  const { deployMode } = usePlatform();
  const isDesktop = deployMode === "desktop";
  const [serverId, setServerId] = useState<string>("");
  const [server, setServer] = useState<ServerInfo | null>(null);
  const [components, setComponents] = useState<ComponentStatus[]>([]);
  const [loading, setLoading] = useState(true);
  const [checking, setChecking] = useState(false);
  const [checkError, setCheckError] = useState<string | null>(null);
  const [checkErrorKind, setCheckErrorKind] = useState<ConnectionErrorKind | null>(null);
  const [installLogs, setInstallLogs] = useState<SetupLogEvent[]>([]);
  const [activeTab, setActiveTab] = useState<Tab>("overview");
  const [showMenu, setShowMenu] = useState(false);
  const [isRemoving, setIsRemoving] = useState(false);
  const [activeActionComponent, setActiveActionComponent] = useState<string | null>(null);
  const [manualActionComponents, setManualActionComponents] = useState<SetupComponentProgress[]>([]);
  const [manualActionMode, setManualActionMode] = useState<ManualActionMode>(null);
  const [manualActionDone, setManualActionDone] = useState(false);
  const [manualActionFinalStatus, setManualActionFinalStatus] = useState<"completed" | "failed" | null>(null);

  const setupStream = useSetupStream({
    onComplete: (event) => {
      // Re-run health check after install finishes
      void (async () => {
        try {
          if (!serverId) return;
          const result = await systemApi.checkServer(serverId);
          setComponents(result.components);
          setActiveActionComponent(null);
          if (event.status === "completed") {
            showToast(t.servers.detail.toastComponentActionCompleted, "success", t.servers.toastTitles.serverSetup);
          } else {
            showToast(t.servers.detail.toastSomeActionsFailed, "error", t.servers.toastTitles.serverSetup);
          }
        } catch (err) {
          const message = getApiErrorMessage(err, t.servers.detail.toastHealthCheckFailedAfterInstall);
          setCheckError(message);
          showToast(message, "error", t.servers.toastTitles.serverSetup);
        }
      })();
    },
    onLog: (entry) => {
      setInstallLogs((prev) => [...prev, entry]);
    },
  });

  const monitor = useMonitorStream(serverId || null, activeTab === "overview");

  useEffect(() => {
    params.then((p) => setServerId(p.serverId));
  }, [params]);

  const fetchData = useCallback(async () => {
    if (!serverId) return;
    try {
      setLoading(true);
      const s = await systemApi.getServerById(serverId);
      setServer(s);
    } catch {
      setServer(null);
    } finally {
      setLoading(false);
    }
  }, [serverId]);

  const runHealthCheck = useCallback(async () => {
    if (!serverId) return;
    setChecking(true);
    setCheckError(null);
    setCheckErrorKind(null);
    try {
      const result = await systemApi.checkServer(serverId);
      setComponents(result.components);
    } catch (err) {
      const message = getApiErrorMessage(err, t.servers.detail.toastHealthCheckFailed);
      const body = err instanceof ApiError ? err.body : undefined;
      const kind = classifyConnectionError(body, message);
      setComponents([]);
      setCheckError(message);
      setCheckErrorKind(kind);
      // The inline banner is the primary surface - only toast for unexpected
      // shapes so the user isn't getting both a toast and a banner for the
      // same problem.
      if (kind === "unknown") {
        showToast(message, "error", t.servers.toastTitles.serverCheck);
      }
    } finally {
      setChecking(false);
    }
  }, [serverId, showToast, t]);

  const installMissingComponents = useCallback(async () => {
    const missing = components.filter(
      (component) =>
        !component.healthy && component.installable,
    );

    if (missing.length === 0) {
      showToast(t.servers.detail.toastNoInstallableMissing, "success", t.servers.toastTitles.serverSetup);
      return;
    }

    setActiveActionComponent(null);
    setManualActionComponents([]);
    setManualActionMode(null);
    setManualActionDone(false);
    setManualActionFinalStatus(null);
    setCheckError(null);
    setInstallLogs([]);
    setActiveTab("components");

    try {
      if (!serverId) {
        showToast(t.servers.detail.toastServerMissing, "error", t.servers.toastTitles.serverSetup);
        return;
      }
      await setupStream.startInstall(serverId, missing.map((c) => c.name));
    } catch (err) {
      const message = getApiErrorMessage(err, t.servers.detail.toastFailedStartInstall);
      setCheckError(message);
      showToast(message, "error", t.servers.toastTitles.serverSetup);
    }
  }, [components, serverId, showToast, setupStream, t]);

  const runComponentAction = useCallback(async (component: ComponentStatus) => {
    if (!serverId) {
      showToast(t.servers.detail.toastServerMissing, "error", t.servers.toastTitles.serverSetup);
      return;
    }

    setActiveActionComponent(component.name);
    setManualActionComponents([]);
    setManualActionMode(null);
    setManualActionDone(false);
    setManualActionFinalStatus(null);
    setCheckError(null);
    setInstallLogs([]);
    setActiveTab("components");

    try {
      await setupStream.startInstall(serverId, [component.name]);
    } catch (err) {
      const message = getApiErrorMessage(err, interpolate(t.servers.detail.toastFailedRun, { label: component.label }));
      setCheckError(message);
      showToast(message, "error", t.servers.toastTitles.serverSetup);
    }
  }, [serverId, setupStream, showToast, t]);

  const removeComponentAction = useCallback((component: ComponentStatus) => {
    const modalId = showModal({
      title: interpolate(t.servers.detail.removeComponentTitle, { label: component.label }),
      message:
        component.name === "openresty"
          ? t.servers.detail.removeOpenrestyMessage
          : interpolate(t.servers.detail.removeComponentMessage, { label: component.label }),
      icon: "warning",
      width: "100%",
      maxWidth: "32rem",
      buttons: [
        {
          label: t.servers.detail.cancel,
          variant: "secondary",
          onClick: () => hideModal(modalId),
        },
        {
          label: t.servers.detail.remove,
          variant: "danger",
          onClick: async () => {
            hideModal(modalId);
            if (!serverId) {
              showToast(t.servers.detail.toastServerMissing, "error", t.servers.toastTitles.serverSetup);
              return;
            }

            try {
              setActiveActionComponent(component.name);
              setIsRemoving(true);
              setManualActionMode("remove");
              setManualActionDone(false);
              setManualActionFinalStatus(null);
              setManualActionComponents([
                {
                  name: component.name,
                  label: component.label,
                  status: "removing",
                },
              ]);
              setCheckError(null);
              setInstallLogs([]);
              setActiveTab("components");
              const result = await systemApi.removeComponent(serverId, component.name);
              if (!result.success) {
                setInstallLogs((result.logs ?? []).map((message) => ({
                  type: "log",
                  timestamp: new Date().toISOString(),
                  component: component.name,
                  message,
                  level: "error" as const,
                })));
                setManualActionComponents([
                  {
                    name: component.name,
                    label: component.label,
                    status: "failed",
                    error: result.error || interpolate(t.servers.detail.toastFailedRemove, { label: component.label }),
                  },
                ]);
                setManualActionDone(true);
                setManualActionFinalStatus("failed");
                throw new Error(result.error || interpolate(t.servers.detail.toastFailedRemove, { label: component.label }));
              }

              setInstallLogs((result.logs ?? []).map((message) => ({
                type: "log",
                timestamp: new Date().toISOString(),
                component: component.name,
                message,
                level: "info" as const,
              })));
              setManualActionComponents([
                {
                  name: component.name,
                  label: component.label,
                  status: "removed",
                },
              ]);
              setManualActionDone(true);
              setManualActionFinalStatus("completed");

              const next = await systemApi.checkServer(serverId);
              setComponents(next.components);
              showToast(interpolate(t.servers.detail.toastComponentRemoved, { label: component.label }), "success", t.servers.toastTitles.serverSetup);
            } catch (err) {
              if (isAbortError(err)) {
                // Request timed out but removal may still be running server-side
                setManualActionComponents([{
                  name: component.name,
                  label: component.label,
                  status: "failed",
                  error: t.servers.detail.removalTakingLonger,
                }]);
                setManualActionDone(true);
                setManualActionFinalStatus("failed");
                setCheckError(t.servers.detail.removalTimedOutError);
                showToast(t.servers.detail.toastRemovalTimedOut, "error", t.servers.toastTitles.serverSetup);
              } else {
                const message = getApiErrorMessage(err, interpolate(t.servers.detail.toastFailedRemove, { label: component.label }));
                setCheckError(message);
                showToast(message, "error", t.servers.toastTitles.serverSetup);
              }
            } finally {
              setActiveActionComponent(null);
              setIsRemoving(false);
            }
          },
        },
      ],
    });
  }, [hideModal, serverId, showModal, showToast, t]);

  useEffect(() => {
    if (!serverId) return;
    fetchData();
    runHealthCheck();

    // Check for active install session (page reload recovery)
    void (async () => {
      try {
        const session = await systemApi.getInstallSession();
        if (
          session.active &&
          session.status === "running" &&
          session.sessionId &&
          session.serverId === serverId
        ) {
          setActiveTab("components");
          void setupStream.attachToSession(session.sessionId);
        }
      } catch {
        // No active session
      }
    })();
  }, [serverId, fetchData, runHealthCheck]); // eslint-disable-line react-hooks/exhaustive-deps

  const handleDelete = useCallback(() => {
    const modalId = showModal({
      title: t.servers.detail.removeServer,
      message: t.servers.detail.removeServerMessage,
      icon: "warning",
      buttons: [
        {
          label: t.servers.detail.cancel,
          variant: "secondary",
          onClick: () => hideModal(modalId),
        },
        {
          label: t.servers.detail.remove,
          variant: "danger",
          onClick: async () => {
            try {
              await systemApi.deleteServerEntry(serverId);
              hideModal(modalId);
              showToast(t.servers.detail.toastServerRemoved, "success", t.servers.toastTitles.server);
              router.push("/servers");
            } catch (err) {
              showToast(
                getApiErrorMessage(err, t.servers.detail.toastFailedRemoveServer),
                "error",
                t.servers.toastTitles.server,
              );
            }
          },
        },
      ],
    });
  }, [serverId, router, showToast, showModal, hideModal, t]);

  if (loading) {
    return (
      <div className="min-h-screen bg-background flex items-center justify-center">
        <Loader2 className="size-6 animate-spin text-muted-foreground" />
      </div>
    );
  }

  if (!server) {
    return (
      <PageContainer>
          <div className="flex items-center gap-3 mb-6">
            <button
              onClick={() => router.push("/servers")}
              className="w-8 h-8 rounded-lg hover:bg-muted flex items-center justify-center transition-colors"
            >
              <ArrowLeft className="size-4 text-muted-foreground rtl:rotate-180" />
            </button>
            <h1 className="text-2xl font-medium text-foreground/80">
              {t.servers.detail.serverNotFound}
            </h1>
          </div>
          <p className="text-sm text-muted-foreground">
            {interpolate(t.servers.detail.noServerConfigured, { id: serverId })}
          </p>
      </PageContainer>
    );
  }

  // Edit view shares the same route as the detail page (?edit=true) and reuses
  // the credentials form so add/edit stay in sync.
  if (editing) {
    return (
      <PageContainer>
          <div className="flex items-center gap-3 mb-6">
            <button
              onClick={() => router.push(`/servers/${serverId}`)}
              className="w-8 h-8 rounded-lg hover:bg-muted flex items-center justify-center transition-colors"
            >
              <ArrowLeft className="size-4 text-muted-foreground rtl:rotate-180" />
            </button>
            <div>
              <h1
                className="text-2xl font-medium text-foreground/80"
                style={{ letterSpacing: "-0.2px" }}
              >
                {t.servers.detail.editServer}
              </h1>
              <p className="text-sm text-muted-foreground/70 mt-0.5">
                {interpolate(t.servers.detail.editSubtitle, { name: server.name || server.sshHost })}
              </p>
            </div>
          </div>

          <div className="max-w-2xl">
            <ServerForm
              key={server.id}
              server={server}
              submitLabel={t.servers.detail.saveChanges}
              onSaved={({ server: updated }) => {
                setServer(updated);
                router.push(`/servers/${serverId}`);
              }}
            />
          </div>
      </PageContainer>
    );
  }

  const allHealthy =
    components.length > 0 && components.every((c) => c.healthy);
  const actionBusy = setupStream.isConnected || setupStream.isConnecting || isRemoving;
  const visibleActionComponents = manualActionComponents.length > 0
    ? manualActionComponents
    : setupStream.components;
  const visibleActionMode = manualActionComponents.length > 0
    ? manualActionMode ?? "remove"
    : "install";
  const visibleActionDone = manualActionComponents.length > 0
    ? manualActionDone
    : setupStream.isDone;
  const visibleActionFinalStatus = manualActionComponents.length > 0
    ? manualActionFinalStatus
    : setupStream.finalStatus;

  return (
    <PageContainer>
        {/* Header */}
        <div className="flex items-center gap-3 mb-6">
          <button
            onClick={() => router.push("/servers")}
            className="w-8 h-8 rounded-lg hover:bg-muted flex items-center justify-center transition-colors"
          >
            <ArrowLeft className="size-4 text-muted-foreground rtl:rotate-180" />
          </button>
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-2">
              <h1
                className="text-2xl font-medium text-foreground/80 truncate"
                style={{ letterSpacing: "-0.2px" }}
              >
                {server.name || server.sshHost}
              </h1>
              {allHealthy ? (
                <div className="shrink-0 inline-flex items-center gap-1 px-2 py-0.5 bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 text-xs font-medium rounded-full">
                  <CheckCircle2 className="size-3" />
                  {t.servers.detail.healthy}
                </div>
              ) : components.length > 0 ? (
                <div className="shrink-0 inline-flex items-center gap-1 px-2 py-0.5 bg-orange-500/10 text-orange-600 dark:text-orange-400 text-xs font-medium rounded-full">
                  <XCircle className="size-3" />
                  {t.servers.detail.issues}
                </div>
              ) : null}
            </div>
            <p className="text-sm text-muted-foreground/70 mt-1 font-mono">
              {server.sshUser ?? "root"}@{server.sshHost}:{server.sshPort ?? 22}
            </p>
          </div>
          <div className="flex items-center gap-1.5">
            <button
              onClick={() => router.push(`/servers/${serverId}?edit=true`)}
              className="inline-flex items-center gap-2 px-4 py-2 bg-muted/50 text-foreground text-sm font-medium rounded-xl hover:bg-muted transition-colors"
            >
              <Settings2 className="size-4" />
              {t.servers.detail.edit}
            </button>
            <div className="relative">
              <button
                onClick={() => setShowMenu((v) => !v)}
                className="w-8 h-8 rounded-lg hover:bg-muted flex items-center justify-center transition-colors text-muted-foreground hover:text-foreground"
              >
                <MoreHorizontal className="size-4" />
              </button>
              {showMenu && (
                <>
                  <div
                    className="fixed inset-0 z-40"
                    onClick={() => setShowMenu(false)}
                  />
                  <div className="absolute end-0 top-full mt-1 z-50 w-48 bg-popover border border-border rounded-xl shadow-lg py-1">
                    <button
                      onClick={() => {
                        setShowMenu(false);
                        handleDelete();
                      }}
                      className="w-full flex items-center gap-2 px-3 py-2 text-sm text-red-600 dark:text-red-400 hover:bg-red-500/5 transition-colors"
                    >
                      <Trash2 className="size-3.5" />
                      {t.servers.detail.removeServer}
                    </button>
                  </div>
                </>
              )}
            </div>
          </div>
        </div>

        {/* Connection error banner - surfaces SSH-unreachable / auth-failed /
            mis-configured state above the tabs so the user has context the
            moment they open the page, not just a toast that disappears. */}
        {checkErrorKind && checkError && (
          <ConnectionBanner
            serverId={serverId}
            kind={checkErrorKind}
            host={server.sshHost}
            port={server.sshPort ?? 22}
            message={checkError}
            retrying={checking}
            onRetry={runHealthCheck}
          />
        )}

        {/* Main Grid */}
        <div className="grid grid-cols-1 lg:grid-cols-[1fr_340px] gap-6">
          {/* Left column */}
          <div className="min-w-0">
            {/* Tabs */}
            <div className="flex items-center gap-1 mb-6 border-b border-border/50">
              {TABS.filter((tab) => !tab.desktopOnly || isDesktop).map(({ key, icon: Icon }) => (
                <button
                  key={key}
                  onClick={() => setActiveTab(key)}
                  className={`inline-flex items-center gap-2 px-4 py-2.5 text-sm font-medium transition-colors relative ${
                    activeTab === key
                      ? "text-foreground"
                      : "text-muted-foreground hover:text-foreground/70"
                  }`}
                >
                  <Icon className="size-4" />
                  {t.servers.detail.tabs[key]}
                  {activeTab === key && (
                    <span className="absolute bottom-0 start-0 end-0 h-0.5 bg-primary rounded-full" />
                  )}
                </button>
              ))}
            </div>

            {/* Tab content */}
            {activeTab === "overview" && (
              <OverviewTab
                stats={monitor.stats}
                components={components}
                checking={checking}
                monitorConnected={monitor.isConnected}
                monitorError={monitor.error}
                onReconnectMonitor={monitor.reconnect}
              />
            )}

            {activeTab === "components" && (
              <ComponentsTab
                components={components}
                checking={checking}
                checkError={checkError}
                onRecheck={runHealthCheck}
                onInstallMissing={installMissingComponents}
                onRunComponentAction={runComponentAction}
                onRemoveComponentAction={removeComponentAction}
                busy={actionBusy}
                activeActionComponent={activeActionComponent}
                installDone={visibleActionDone}
                installFinalStatus={visibleActionFinalStatus}
                installComponents={visibleActionComponents}
                actionMode={visibleActionMode}
                installLogs={installLogs}
                onDismissInstall={() => {
                  setInstallLogs([]);
                  setManualActionComponents([]);
                  setManualActionMode(null);
                  setManualActionDone(false);
                  setManualActionFinalStatus(null);
                }}
              />
            )}

            {activeTab === "security" && (
              <RateLimitSettings serverId={serverId} />
            )}

            {activeTab === "ports" && isDesktop && serverId && (
              <div className="max-w-2xl">
                <PortForwardingCard serverId={serverId} />
              </div>
            )}

            {activeTab === "terminal" && (
              <TerminalTab
                serverId={serverId}
                serverName={server?.name ?? undefined}
                enabled={activeTab === "terminal"}
              />
            )}
          </div>

          {/* Right sidebar - offset to align with tab content below tab bar */}
          <div className="lg:pt-[65px] space-y-4 lg:sticky lg:top-6 lg:self-start">
            {/* Server details */}
            <div className="bg-card rounded-2xl border border-border/50 p-5">
              <div className="flex items-center gap-2 mb-4">
                <Server className="size-4 text-muted-foreground" />
                <h3 className="font-semibold text-foreground text-sm">
                  {t.servers.detail.connection}
                </h3>
              </div>
              <div className="space-y-3">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <div className="w-8 h-8 rounded-lg bg-muted/60 flex items-center justify-center">
                      <Globe className="size-4 text-muted-foreground" />
                    </div>
                    <span className="text-sm text-muted-foreground">{t.servers.detail.host}</span>
                  </div>
                  <span className="text-sm font-medium text-foreground font-mono truncate ms-3 max-w-[140px]">
                    {server.sshHost}
                  </span>
                </div>
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <div className="w-8 h-8 rounded-lg bg-muted/60 flex items-center justify-center">
                      <User className="size-4 text-muted-foreground" />
                    </div>
                    <span className="text-sm text-muted-foreground">{t.servers.detail.user}</span>
                  </div>
                  <span className="text-sm font-medium text-foreground font-mono">
                    {server.sshUser ?? "root"}
                  </span>
                </div>

                <div className="h-px bg-border/60 my-2" />

                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <div className="w-8 h-8 rounded-lg bg-muted/60 flex items-center justify-center">
                      <KeyRound className="size-4 text-muted-foreground" />
                    </div>
                    <span className="text-sm text-muted-foreground">{t.servers.detail.auth}</span>
                  </div>
                  <span className="text-sm font-medium text-foreground">
                    {server.sshAuthMethod === "key" ? t.servers.detail.authSshKey : t.servers.detail.authPassword}
                  </span>
                </div>
              </div>
            </div>

          </div>
        </div>
    </PageContainer>
  );
}
