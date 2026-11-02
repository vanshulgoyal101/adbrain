import * as nodeModule from "node:module";
import { fileURLToPath } from "node:url";

const stubUrl = new URL("./server-only-cli-stub.cjs", import.meta.url).href;
const stubPath = fileURLToPath(stubUrl);

// Node < 22.15 has no synchronous `registerHooks` (the shared Mac defaults to
// 22.12), so CommonJS falls back to a scoped `_resolveFilename` patch.
function registerCommonJsFallback(Module) {
  const original = Module._resolveFilename;
  let active = true;
  function resolveServerOnly(request, ...rest) {
    if (active && request === "server-only") return stubPath;
    return original.call(this, request, ...rest);
  }
  Module._resolveFilename = resolveServerOnly;
  return {
    deregister() {
      active = false;
      if (Module._resolveFilename === resolveServerOnly) Module._resolveFilename = original;
    },
  };
}

export function registerTrustedServerOnly({ registerHooks = nodeModule.registerHooks, Module = nodeModule.Module } = {}) {
  if (typeof registerHooks !== "function") return registerCommonJsFallback(Module);
  return registerHooks({
    resolve(specifier, context, nextResolve) {
      if (specifier === "server-only") return { url: stubUrl, shortCircuit: true };
      return nextResolve(specifier, context);
    },
  });
}

// For whole-process CLIs: on older Node, ES module imports also need an
// (irremovable) async loader hook next to the CommonJS fallback.
export function registerTrustedServerOnlyForProcess(options = {}) {
  const { registerHooks = nodeModule.registerHooks, register = nodeModule.register } = options;
  const hook = registerTrustedServerOnly(options);
  if (typeof registerHooks !== "function") {
    const loader = `export async function resolve(specifier, context, nextResolve) {
  if (specifier === "server-only") return { url: ${JSON.stringify(stubUrl)}, shortCircuit: true };
  return nextResolve(specifier, context);
}`;
    register(`data:text/javascript,${encodeURIComponent(loader)}`);
  }
  return hook;
}
