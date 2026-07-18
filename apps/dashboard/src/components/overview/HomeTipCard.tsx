"use client";

import Link from "next/link";
import { ArrowRight, GitBranch, Zap } from "lucide-react";

import { useGitHub } from "@/context/GitHubContext";
import { useI18n } from "@/components/i18n-provider";

interface HomeTipCardProps {
  projectCount: number;
  loading: boolean;
}

interface HomeTip {
  text: string;
  href: string;
  label: string;
}

function getHomeTips(params: {
  connected: boolean;
  loading: boolean;
  projectCount: number;
  copy: {
    connectText: string;
    connectLabel: string;
    createText: string;
    createLabel: string;
    settingsText: string;
    settingsLabel: string;
  };
}): HomeTip[] {
  const tips: HomeTip[] = [];

  if (!params.connected) {
    tips.push({
      text: params.copy.connectText,
      href: "/settings/git",
      label: params.copy.connectLabel,
    });
  }

  if (!params.loading && params.projectCount === 0) {
    tips.push({
      text: params.copy.createText,
      href: "/new",
      label: params.copy.createLabel,
    });
  }

  if (params.connected && params.projectCount > 0) {
    tips.push({
      text: params.copy.settingsText,
      href: "/settings",
      label: params.copy.settingsLabel,
    });
  }

  return tips;
}

export default function HomeTipCard({ projectCount, loading }: HomeTipCardProps) {
  const gitHub = useGitHub();
  const { t } = useI18n();
  const tip = getHomeTips({
    connected: gitHub.connected,
    loading: loading || gitHub.loading,
    projectCount,
    copy: t.overview.homeTip,
  })[0];

  if (tip) {
    return (
      <div className="bg-gradient-to-br from-primary/5 via-primary/3 to-transparent rounded-2xl border border-primary/10 p-5">
        <div className="flex items-center gap-2 mb-3">
          <Zap className="size-4 text-primary" />
          <h3 className="font-semibold text-foreground text-sm">{t.overview.homeTip.quickTip}</h3>
        </div>
        <p className="text-sm text-muted-foreground leading-relaxed">{tip.text}</p>
        <Link
          href={tip.href}
          className="inline-flex items-center gap-1 text-sm font-medium text-primary hover:text-primary/80 mt-3 transition-colors"
        >
          {tip.label}
          <ArrowRight className="size-3.5 rtl:rotate-180" />
        </Link>
      </div>
    );
  }

  return (
    <div className="bg-gradient-to-br from-primary/5 via-primary/3 to-transparent rounded-2xl border border-primary/10 p-5">
      <div className="flex items-center gap-2 mb-3">
        <GitBranch className="size-4 text-primary" />
        <h3 className="font-semibold text-foreground text-sm">GitHub</h3>
      </div>
      <div className="flex items-center gap-3">
        {gitHub.accounts[0]?.avatar_url && (
          <img
            src={gitHub.accounts[0].avatar_url}
            alt={gitHub.userLogin}
            className="size-8 rounded-full"
          />
        )}
        <div>
          <p className="text-sm font-medium text-foreground">{gitHub.userLogin}</p>
          <p className="text-xs text-muted-foreground">{t.overview.homeTip.connected}</p>
        </div>
      </div>
    </div>
  );
}