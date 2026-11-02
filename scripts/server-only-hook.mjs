import { registerHooks } from "node:module";

const emptyModule = new URL("./server-only-cli-stub.cjs", import.meta.url).href;

export function registerTrustedServerOnly() {
  return registerHooks({
    resolve(specifier, context, nextResolve) {
      if (specifier === "server-only") return { url: emptyModule, shortCircuit: true };
      return nextResolve(specifier, context);
    },
  });
}
