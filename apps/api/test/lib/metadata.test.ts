import { describe, expect, it } from "vitest";

import {
  parseDeploymentMetadata,
  vercelMetadataParser,
  renderMetadataParser,
} from "@repo/core";
import { detectStack, type RepoFile } from "../../src/lib/stack-detector";

function files(...names: string[]): RepoFile[] {
  return names.map((name) =>
    name.endsWith("/") ? { name: name.slice(0, -1), type: "dir" } : { name, type: "file" },
  );
}

// ─── vercel.json parser ──────────────────────────────────────────────────────

describe("vercelMetadataParser", () => {
  it("extracts local build config", () => {
    const meta = vercelMetadataParser.parse({
      "vercel.json": JSON.stringify({
        installCommand: "npm ci",
        buildCommand: "vite build",
        outputDirectory: "build",
        framework: "vite",
      }),
    });
    expect(meta).toMatchObject({
      source: "vercel",
      installCommand: "npm ci",
      buildCommand: "vite build",
      outputDirectory: "build",
      framework: "vite",
    });
    expect(meta?.nonLocal).toBeUndefined();
  });

  it("flags nonLocal when the build cd's into another directory", () => {
    const meta = vercelMetadataParser.parse({
      "vercel.json": JSON.stringify({
        installCommand: "npm install && cd frontend && npm install",
        buildCommand: "cd frontend && npm run build",
        outputDirectory: "frontend/dist",
      }),
    });
    expect(meta?.nonLocal).toBe(true);
  });

  it("does NOT flag nonLocal for a bare `cd .`", () => {
    const meta = vercelMetadataParser.parse({
      "vercel.json": JSON.stringify({ buildCommand: "cd . && npm run build" }),
    });
    expect(meta?.nonLocal).toBeUndefined();
  });

  it("captures SPA rewrites", () => {
    const meta = vercelMetadataParser.parse({
      "vercel.json": JSON.stringify({ rewrites: [{ source: "/(.*)", destination: "/index.html" }] }),
    });
    expect(meta?.rewrites).toEqual([{ source: "/(.*)", destination: "/index.html" }]);
  });

  it("returns null for invalid JSON and for an empty config", () => {
    expect(vercelMetadataParser.parse({ "vercel.json": "{not json" })).toBeNull();
    expect(vercelMetadataParser.parse({ "vercel.json": "{}" })).toBeNull();
    expect(vercelMetadataParser.parse({})).toBeNull();
  });

  it("captures the full routing config (rewrites/redirects/headers/cleanUrls/trailingSlash)", () => {
    const meta = vercelMetadataParser.parse({
      "vercel.json": JSON.stringify({
        rewrites: [{ source: "/api/(.*)", destination: "/api" }],
        redirects: [{ source: "/old", destination: "/new", permanent: true }],
        headers: [{ source: "/(.*)", headers: [{ key: "X-Frame-Options", value: "DENY" }] }],
        cleanUrls: true,
        trailingSlash: false,
      }),
    });
    expect(meta?.routing).toEqual({
      rewrites: [{ source: "/api/(.*)", destination: "/api" }],
      redirects: [{ source: "/old", destination: "/new", permanent: true }],
      headers: [{ source: "/(.*)", headers: [{ key: "X-Frame-Options", value: "DENY" }] }],
      cleanUrls: true,
      trailingSlash: false,
    });
  });

  it("routing is a signal even when there are no build fields", () => {
    const meta = vercelMetadataParser.parse({
      "vercel.json": JSON.stringify({ redirects: [{ source: "/a", destination: "/b" }] }),
    });
    expect(meta?.routing?.redirects).toEqual([{ source: "/a", destination: "/b" }]);
  });
});

// ─── render.yaml parser ──────────────────────────────────────────────────────

describe("renderMetadataParser", () => {
  const RENDER = [
    "services:",
    "  - type: web",
    "    name: ems-api",
    "    buildCommand: npm install",
    "    startCommand: npm start",
    "    envVars:",
    "      - key: NODE_VERSION",
    "        value: 24",
    "      - key: MONGO_URI",
    "        sync: false",
    "",
  ].join("\n");

  it("extracts the start command as a fill-only hint", () => {
    const meta = renderMetadataParser.parse({ "render.yaml": RENDER });
    expect(meta?.source).toBe("render");
    expect(meta?.fillOnly).toBe(true);
    expect(meta?.startCommand).toBe("npm start");
  });

  it("suppresses a bare-install buildCommand (it's install, not build)", () => {
    const meta = renderMetadataParser.parse({ "render.yaml": RENDER });
    expect(meta?.buildCommand).toBeUndefined();
  });

  it("captures literal envVars and skips synced secrets", () => {
    const meta = renderMetadataParser.parse({ "render.yaml": RENDER });
    expect(meta?.env).toEqual({ NODE_VERSION: "24" });
  });
});

// ─── registry ────────────────────────────────────────────────────────────────

describe("parseDeploymentMetadata", () => {
  it("returns sources in precedence order (vercel before render)", () => {
    const list = parseDeploymentMetadata({
      "vercel.json": JSON.stringify({ buildCommand: "vite build" }),
      "render.yaml": "services:\n  - type: web\n    startCommand: npm start\n",
    });
    expect(list.map((m) => m.source)).toEqual(["vercel", "render"]);
  });
});

// ─── detectStack integration ─────────────────────────────────────────────────

describe("detectStack - metadata overrides", () => {
  it("applies a self-contained vercel.json build config over detection", () => {
    const result = detectStack(
      files("package.json", "vite.config.ts"),
      {
        dependencies: { vite: "^8.0.0", react: "^19.0.0", "react-dom": "^19.0.0" },
        scripts: { build: "vite build" },
      },
      { "vercel.json": JSON.stringify({ buildCommand: "vite build --mode production", outputDirectory: "build" }) },
    );
    expect(result.stack).toBe("vite");
    expect(result.buildCommand).toBe("vite build --mode production");
    expect(result.outputDirectory).toBe("build");
  });

  it("does NOT apply a nonLocal (cd elsewhere) vercel.json to the directory it sits in", () => {
    const result = detectStack(
      files("package.json", "server.js"),
      { dependencies: { express: "^5.0.0" }, scripts: { start: "node server.js" } },
      {
        "vercel.json": JSON.stringify({
          installCommand: "npm install && cd frontend && npm install",
          buildCommand: "cd frontend && npm run build",
          outputDirectory: "frontend/dist",
        }),
      },
    );
    expect(result.stack).toBe("express");
    expect(result.buildCommand).toBe(""); // express default, not "cd frontend && ..."
    expect(result.installCommand).not.toContain("cd frontend");
    expect(result.outputDirectory).not.toBe("frontend/dist");
  });

  it("render.yaml never overrides a start command detection already resolved", () => {
    const result = detectStack(
      files("package.json", "server.js"),
      { dependencies: { express: "^5.0.0" }, scripts: { start: "node server.js" } },
      { "render.yaml": "services:\n  - type: web\n    startCommand: node OTHER.js\n" },
    );
    expect(result.startCommand).toContain("start"); // npm run start, not "node OTHER.js"
    expect(result.startCommand).not.toContain("OTHER");
  });

  it("a vercel framework hint reclassifies the stack", () => {
    const result = detectStack(
      files("package.json"),
      { dependencies: {} },
      { "vercel.json": JSON.stringify({ framework: "vite" }) },
    );
    expect(result.stack).toBe("vite");
    expect(result.category).toBe("frontend");
  });
});

// ─── Vercel "Output Directory" → static build ────────────────────────────────

describe("detectStack - static output directory classification", () => {
  it("treats an ambiguous node repo with a vercel outputDirectory as a static build", () => {
    // Webpack-style app: build → a custom output dir, a DEV `start` script, no framework preset.
    const result = detectStack(
      files("package.json", ".babelrc"),
      {
        dependencies: { react: "^15.0.0", "react-dom": "^15.0.0", redux: "^3.5.2" },
        scripts: { start: "webpack-dev-server --progress", build: "webpack --config ./webpack.production.config.js" },
      },
      { "vercel.json": JSON.stringify({ buildCommand: "npm run build", outputDirectory: "docs" }) },
    );
    expect(result.category).toBe("static");
    expect(result.outputDirectory).toBe("docs");
    expect(result.buildCommand).toBe("npm run build");
    expect(result.startCommand).toBe(""); // dev server dropped - it's a static build
  });

  it("keeps a Vite SPA static with its output directory", () => {
    const result = detectStack(
      files("package.json", "vite.config.js", "index.html"),
      {
        dependencies: { react: "^18.0.0", "react-dom": "^18.0.0", vite: "^5.0.0" },
        scripts: { build: "vite build", start: "vite --port 3000" },
      },
      { "vercel.json": JSON.stringify({ framework: "vite", outputDirectory: "dist" }) },
    );
    expect(result.stack).toBe("vite");
    expect(result.category).toBe("frontend");
    expect(result.outputDirectory).toBe("dist");
    expect(result.startCommand).toBe(""); // static SPA - no server
  });

  it("does NOT turn a genuine server framework static just because outputDirectory is set", () => {
    const result = detectStack(
      files("package.json", "next.config.js"),
      {
        dependencies: { next: "^15.0.0", react: "^19.0.0", "react-dom": "^19.0.0" },
        scripts: { build: "next build", start: "next start" },
      },
      { "vercel.json": JSON.stringify({ outputDirectory: ".next" }) },
    );
    expect(result.stack).toBe("nextjs");
    expect(result.startCommand).toContain("start"); // still a server (SSR)
  });
});
