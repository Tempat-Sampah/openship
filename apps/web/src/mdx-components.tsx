import defaultMdxComponents from "fumadocs-ui/mdx";
import type { MDXComponents } from "mdx/types";
import { InstallTabs } from "@/components/install-tabs";

// Native Fumadocs MDX components (Cards, Callouts, code blocks with copy, etc.),
// plus our own components usable in .mdx without an explicit import.
export function getMDXComponents(components?: MDXComponents): MDXComponents {
  return {
    ...defaultMdxComponents,
    InstallTabs,
    ...components,
  };
}
