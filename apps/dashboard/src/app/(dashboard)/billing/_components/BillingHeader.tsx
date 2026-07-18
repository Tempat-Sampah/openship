"use client";

import { useI18n } from "@/components/i18n-provider";

/**
 * Billing page header. Client component because the surrounding BillingLayout
 * is an async server component (it fetches billing state), and locale is a
 * client-runtime concern — server-rendered text can't localize.
 */
export function BillingHeader() {
  const { t } = useI18n();
  return (
    <div>
      <h1 className="text-2xl font-medium text-foreground/80" style={{ letterSpacing: "-0.2px" }}>
        {t.billing.layout.title}
      </h1>
      <p className="mt-1 text-sm text-muted-foreground/70">{t.billing.layout.subtitle}</p>
    </div>
  );
}
