"use client";

import React, { useEffect, useMemo, useRef } from "react";
import { ShieldCheck, Terminal, ShieldAlert, Server } from "lucide-react";
import { useDeployment } from "@/context/DeploymentContext";
import { useMonitorStream } from "@/hooks/useMonitorStream";
import { useI18n, interpolate } from "@/components/i18n-provider";
import type { RuntimeMode } from "@/context/deployment/types";

/**
 * Inline runtime-isolation picker for a self-hosted SERVER target — the
 * right-column "how it runs" panel, symmetric with CloudPowerPicker. Replaces
 * the old deploy-time modal: the choice is now a visible setting on the target
 * step, persisted to the project (see requestBuildAccess) so it sticks across
 * redeploys.
 *
 * Default: the RAM-aware recommendation (Sandboxed everywhere except <2 GB boxes
 * where the engine itself would contend for the app's memory). Applied
 * automatically only for a FRESH deploy — an existing project's saved choice is
 * hydrated into config.runtimeMode and respected, never overridden.
 */

// Below this RAM the sandbox engine contends for memory with the app — on a
// 512MB/1GB VPS that's a real problem. Above it Docker's overhead is
// single-digit-% CPU + ~30-80MB RAM, negligible vs. the isolation upside.
const TWO_GB = 2 * 1024 * 1024 * 1024;

const ServerRuntimePicker: React.FC = () => {
  const { config, updateConfig } = useDeployment();
  const { t } = useI18n();
  const { stats } = useMonitorStream(config.serverId ?? null, true);

  const runtimeOptions: Array<{
    value: RuntimeMode;
    label: string;
    description: string;
    icon: React.ReactNode;
  }> = [
    {
      value: "docker",
      label: t.deploy.runtime.sandboxedLabel,
      description: t.deploy.runtime.sandboxedDesc,
      icon: <ShieldCheck className="size-5" />,
    },
    {
      value: "bare",
      label: t.deploy.runtime.directLabel,
      description: t.deploy.runtime.directDesc,
      icon: <Terminal className="size-5" />,
    },
  ];

  const hasAutoDefaultedRef = useRef(false);
  const hasUserSelectedRef = useRef(false);

  const lowRam = useMemo(() => (stats ? stats.memTotal < TWO_GB : false), [stats]);
  // Sandbox everywhere except RAM-starved boxes. A nudge + the default, not a lock.
  const recommendedMode: RuntimeMode = lowRam ? "bare" : "docker";
  const ramGB = stats ? (stats.memTotal / (1024 * 1024 * 1024)).toFixed(1) : null;
  const selected = config.runtimeMode;

  // Auto-apply the recommendation ONLY for a fresh deploy (no project yet). For
  // an existing project the value was hydrated from project.runtimeMode — respect
  // the saved choice. Manual selection always wins.
  useEffect(() => {
    if (!stats || hasAutoDefaultedRef.current || hasUserSelectedRef.current) return;
    if (config.projectId) return; // existing project → keep the hydrated/saved value
    hasAutoDefaultedRef.current = true;
    if (config.runtimeMode !== recommendedMode) {
      updateConfig({ runtimeMode: recommendedMode });
    }
  }, [stats, recommendedMode, config.projectId, config.runtimeMode, updateConfig]);

  return (
    // Header outside the cards to match CloudPowerPicker / the left column's
    // heading rhythm, so the first card aligns across the grid row.
    <div className="space-y-3">
      <div>
        <h3 className="text-base font-semibold text-foreground flex items-center gap-2">
          <Server className="size-4 text-muted-foreground" />
          {t.deploy.runtime.heading}
        </h3>
        <p className="text-sm text-muted-foreground mt-0.5">
          {ramGB
            ? interpolate(t.deploy.runtime.subtitleRam, { ram: ramGB })
            : `${t.deploy.runtime.subtitle}.`}
        </p>
      </div>

      <div className="space-y-2">
        {runtimeOptions.map((option) => {
          const isSelected = selected === option.value;
          const isRecommended = option.value === recommendedMode;
          return (
            <button
              key={option.value}
              type="button"
              onClick={() => {
                hasUserSelectedRef.current = true;
                updateConfig({ runtimeMode: option.value });
              }}
              className={`w-full rounded-xl border p-4 text-start transition-all ${
                isSelected
                  ? "border-primary bg-primary/5 ring-1 ring-primary/20"
                  : "border-border/50 bg-card hover:border-primary/30 hover:bg-primary/[0.02]"
              }`}
            >
              <div className="flex items-start gap-3">
                <span className={isSelected ? "text-primary" : "text-muted-foreground"}>
                  {option.icon}
                </span>
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2">
                    <p className={`text-sm font-medium ${isSelected ? "text-foreground" : "text-muted-foreground"}`}>
                      {option.label}
                    </p>
                    {isRecommended && (
                      <span className="inline-flex items-center rounded-full bg-emerald-500/10 px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wider text-emerald-600 dark:text-emerald-400">
                        {t.deploy.runtime.recommended}
                      </span>
                    )}
                  </div>
                  <p className="mt-0.5 text-xs text-muted-foreground leading-relaxed">
                    {option.description}
                  </p>
                </div>
              </div>
            </button>
          );
        })}
      </div>

      {/* Security caveat — only when Direct is selected (don't preach when the
          safer option is already chosen). */}
      {selected === "bare" && (
        <div className="flex items-start gap-2.5 rounded-xl border border-amber-500/20 bg-amber-500/[0.07] px-3 py-2.5">
          <ShieldAlert className="size-4 text-amber-600 shrink-0 mt-0.5" />
          <p className="text-[12px] leading-relaxed text-amber-700 dark:text-amber-300">
            {lowRam ? t.deploy.runtime.caveatLowRam : t.deploy.runtime.caveat}
          </p>
        </div>
      )}
    </div>
  );
};

export default React.memo(ServerRuntimePicker);
