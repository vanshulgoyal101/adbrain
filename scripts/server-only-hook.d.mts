export interface TrustedServerOnlyOptions {
  registerHooks?: typeof import("node:module").registerHooks | undefined;
  register?: typeof import("node:module").register;
  Module?: typeof import("node:module").Module;
}
export interface TrustedServerOnlyHook {
  deregister(): void;
}
export function registerTrustedServerOnly(options?: TrustedServerOnlyOptions): TrustedServerOnlyHook;
export function registerTrustedServerOnlyForProcess(options?: TrustedServerOnlyOptions): TrustedServerOnlyHook;
