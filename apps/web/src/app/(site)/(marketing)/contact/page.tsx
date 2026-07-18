import type { Metadata } from "next";
import { Navbar, Footer } from "@/components/landing";

const PAGE_TITLE = "Contact";
const PAGE_DESCRIPTION =
  "Reach the Openship team — community, sales, security, privacy, and legal. Or open an issue on GitHub.";

export const metadata: Metadata = {
  title: PAGE_TITLE,
  description: PAGE_DESCRIPTION,
  alternates: { canonical: "/contact" },
  openGraph: {
    title: `${PAGE_TITLE} - Openship`,
    description: PAGE_DESCRIPTION,
    url: "/contact",
    type: "website",
  },
  twitter: {
    card: "summary_large_image",
    title: `${PAGE_TITLE} - Openship`,
    description: PAGE_DESCRIPTION,
  },
};

type Channel = {
  id: string;
  title: string;
  desc: string;
  label: string;
  href: string;
  external?: boolean;
};

const CHANNELS: Channel[] = [
  {
    id: "community",
    title: "Community & bugs",
    desc: "Questions, bug reports, and feature requests happen in the open. This is the fastest way to reach us.",
    label: "github.com/oblien/openship",
    href: "https://github.com/oblien/openship/issues",
    external: true,
  },
  {
    id: "general",
    title: "General",
    desc: "Say hello, partnerships, or press.",
    label: "hello@openship.io",
    href: "mailto:hello@openship.io",
  },
  {
    id: "sales",
    title: "Sales & business",
    desc: "Openship Cloud, Business plans, and SLAs.",
    label: "sales@openship.io",
    href: "mailto:sales@openship.io",
  },
  {
    id: "security",
    title: "Security",
    desc: "Report a vulnerability privately. See the Trust page for our disclosure policy.",
    label: "security@oblien.com",
    href: "mailto:security@oblien.com",
  },
  {
    id: "privacy",
    title: "Privacy",
    desc: "Data-access requests and privacy questions.",
    label: "privacy@openship.io",
    href: "mailto:privacy@openship.io",
  },
  {
    id: "legal",
    title: "Legal",
    desc: "Terms, licensing, and legal notices.",
    label: "legal@openship.io",
    href: "mailto:legal@openship.io",
  },
];

export default function ContactPage() {
  return (
    <>
      <Navbar />
      <main className="legal-root">
        <section className="legal-hero">
          <div className="legal-container">
            <p className="legal-eyebrow">Contact</p>
            <h1 className="legal-title">
              Talk to us.<br />
              <span className="legal-title-soft">Pick the right door.</span>
            </h1>
            <p className="legal-meta">
              Openship is open source — most conversations happen on{" "}
              <a
                href="https://github.com/oblien/openship"
                className="legal-meta-link"
                target="_blank"
                rel="noreferrer"
              >
                GitHub
              </a>
              .
            </p>
          </div>
        </section>

        <section className="legal-body">
          <div className="legal-container">
            <div className="legal-grid">
              <aside className="legal-toc" aria-label="Table of contents">
                <p className="legal-toc-title">Channels</p>
                <ol>
                  {CHANNELS.map((c, i) => (
                    <li key={c.id}>
                      <a href={`#${c.id}`}>
                        <span className="legal-toc-n">{String(i + 1).padStart(2, "0")}</span>
                        {c.title}
                      </a>
                    </li>
                  ))}
                </ol>
              </aside>

              <article className="legal-article">
                {CHANNELS.map((c, i) => (
                  <section key={c.id} id={c.id} className="legal-section">
                    <header className="legal-section-head">
                      <span className="legal-section-n">{String(i + 1).padStart(2, "0")}</span>
                      <h2 className="legal-section-title">{c.title}</h2>
                    </header>
                    <p className="legal-p">{c.desc}</p>
                    <p className="legal-p">
                      <a
                        href={c.href}
                        {...(c.external ? { target: "_blank", rel: "noreferrer" } : {})}
                      >
                        {c.label}
                      </a>
                    </p>
                  </section>
                ))}

                <footer className="legal-foot">
                  <p>
                    Prefer the docs? Read the <a href="/docs">documentation</a> or{" "}
                    <a href="/trust">Trust &amp; Security</a>.
                  </p>
                </footer>
              </article>
            </div>
          </div>
        </section>
      </main>
      <Footer />
    </>
  );
}
