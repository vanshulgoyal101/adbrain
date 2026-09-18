export function safeAuthRedirect(requestedPath: string | null): string {
  return requestedPath?.startsWith("/") && !requestedPath.startsWith("//") &&
    !/[\\\u0000-\u0020]/.test(requestedPath)
    ? requestedPath : "/dashboard";
}