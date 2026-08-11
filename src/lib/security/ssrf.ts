/**
 * SSRF guard for user-supplied URLs (e.g. "autofill from website"). Blocks
 * loopback, private, link-local, and other non-public hosts so a fetch on the
 * server can't be pointed at internal infrastructure or cloud metadata.
 *
 * Note: this is a hostname/literal-IP check. DNS rebinding (a public name that
 * resolves to a private IP) is out of scope here; the fetch also uses a short
 * timeout and follows redirects at the platform level.
 */

function isBlockedIPv4(host: string): boolean {
  const m = host.match(/^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/);
  if (!m) return false;
  const [a, b] = [Number(m[1]), Number(m[2])];
  const octets = [a, b, Number(m[3]), Number(m[4])];
  if (octets.some((n) => n > 255)) return true; // malformed → block
  if (a === 127 || a === 10 || a === 0) return true; // loopback / private / this-host
  if (a === 192 && b === 168) return true; // private
  if (a === 169 && b === 254) return true; // link-local (incl. cloud metadata)
  if (a === 172 && b >= 16 && b <= 31) return true; // private
  if (a >= 224) return true; // multicast / reserved
  return false;
}

/** True if the hostname must not be fetched from the server. */
export function isBlockedHost(hostname: string): boolean {
  let h = (hostname ?? "").trim().toLowerCase().replace(/^\[|\]$/g, "");
  if (!h) return true;

  // Named hosts that resolve to internal networks.
  if (
    h === "localhost" ||
    h.endsWith(".local") ||
    h.endsWith(".internal") ||
    h.endsWith(".localhost")
  ) {
    return true;
  }

  // IPv4-mapped IPv6 (e.g. ::ffff:127.0.0.1) — unwrap and re-check as IPv4.
  const mapped = h.match(/^::ffff:(\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3})$/);
  if (mapped) h = mapped[1];

  // IPv6 loopback / link-local / unique-local.
  if (
    h === "::1" ||
    h === "::" ||
    h.startsWith("fe80:") ||
    h.startsWith("fc") ||
    h.startsWith("fd")
  ) {
    return true;
  }

  return isBlockedIPv4(h);
}

/**
 * Parse and validate a user-supplied website URL. Adds https:// if missing,
 * enforces http(s), and blocks private hosts. Returns the parsed URL or null.
 */
export function parsePublicUrl(input: string): URL | null {
  let raw = (input ?? "").trim();
  if (!raw) return null;

  // A scheme has no dots (host:port does), so a dotless prefix before ":" is a
  // real scheme — reject anything that isn't http(s). Otherwise assume https.
  const scheme = raw.match(/^([a-z][a-z0-9+-]*):/i)?.[1]?.toLowerCase();
  if (scheme) {
    if (scheme !== "http" && scheme !== "https") return null;
  } else {
    raw = `https://${raw}`;
  }

  let parsed: URL;
  try {
    parsed = new URL(raw);
  } catch {
    return null;
  }
  if (!["http:", "https:"].includes(parsed.protocol)) return null;
  if (isBlockedHost(parsed.hostname)) return null;
  return parsed;
}
