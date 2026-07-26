// @lovable.dev/vite-tanstack-config already includes the following — do NOT add them manually
// or the app will break with duplicate plugins:
//   - tanstackStart, viteReact, tailwindcss, tsConfigPaths, nitro (build-only using cloudflare as a default target),
//     componentTagger (dev-only), VITE_* env injection, @ path alias, React/TanStack dedupe,
//     error logger plugins, and sandbox detection (port/host/strictPort).
// You can pass additional config via defineConfig({ vite: { ... }, etc... }) if needed.
import type { Plugin, TransformResult } from "vite";
import { defineConfig } from "@lovable.dev/vite-tanstack-config";

type TransformHandler = (
  this: unknown,
  code: string,
  id: string,
  options?: { ssr?: boolean },
) => TransformResult | Promise<TransformResult> | null | undefined;

function isRootRouteModule(id: string) {
  const file = id.split("?")[0]?.replace(/\\/g, "/") ?? "";
  return file.endsWith("/src/routes/__root.tsx");
}

/**
 * Lovable enables @tanstack/devtools-vite injectSource after tanstackStart.
 * That AST pass stamps data-tsd-source using line numbers that can differ between
 * the SSR and client pipelines, causing hydration mismatches on the document
 * shell (html/head/body in __root.tsx).
 *
 * Skip/strip injection for the root route so SSR HTML matches the client.
 */
function fixTsdSourceHydration(): Plugin {
  return {
    name: "fix-tsd-source-hydration",
    enforce: "pre",
    configResolved(config) {
      const plugin = config.plugins.find(
        (p): p is Plugin =>
          !!p && "name" in p && p.name === "@tanstack/devtools:inject-source",
      );
      if (!plugin?.transform) return;

      const wrap =
        (original: TransformHandler): TransformHandler =>
        function (this: unknown, code, id, options) {
          if (isRootRouteModule(id)) return null;
          return original.call(this, code, id, options);
        };

      const transform = plugin.transform;
      if (typeof transform === "function") {
        plugin.transform = wrap(transform as TransformHandler);
        return;
      }

      if (typeof transform === "object" && typeof transform.handler === "function") {
        transform.handler = wrap(transform.handler as TransformHandler);
      }
    },
    transform(code, id) {
      // Safety net: if inject-source still ran, remove attrs while JSX is intact.
      if (!isRootRouteModule(id) || !code.includes("data-tsd-source")) return;
      return {
        code: code.replace(/\s*data-tsd-source="[^"]*"/g, ""),
        map: null,
      };
    },
  };
}

export default defineConfig({
  // Hostinger / VPS: emit a Node server instead of Cloudflare Workers
  nitro: {
    preset: "node-server",
  },
  tanstackStart: {
    // Redirect TanStack Start's bundled server entry to src/server.ts (our SSR error wrapper).
    // nitro/vite builds from this
    server: { entry: "server" },
  },
  plugins: [fixTsdSourceHydration()],
});
