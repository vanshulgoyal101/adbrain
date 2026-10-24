export function safeAuthRedirect(requestedPath: string | null): string {
  return requestedPath?.startsWith("/") && !requestedPath.startsWith("//") &&
    !/[\\\u0000-\u0020]/.test(requestedPath)
    ? requestedPath : "/dashboard";
}
/**
 * Leave the login page with a full page load. A client-side `router.replace`
 * can reuse a prefetch made while logged out (a cached 307 back to /login).
 */
export function openAfterSignIn(path: string): void {
  window.location.assign(path);
}
