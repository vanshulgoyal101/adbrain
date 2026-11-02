/**
 * #1670: the hand-over's pre-check results in the rep's words (Designer #1736 frames 1 and 1b). The database returns
 * the first relation that blocks (`private.business_transfer_blocker`); each says what's wrong and how to fix it.
 */
export type TransferCheck = { label: string; ok: boolean; problem?: string };

const META = new Set(["public.meta_connections", "private.meta_tokens", "private.meta_connection_attempts", "public.managed_meta_accounts"]);

export function transferBlockerWords(blocker: string | null | undefined): { problem: string } {
  if (!blocker) return { problem: "" };
  if (META.has(blocker)) return { problem: "A Meta account is connected. The owner connects their own after taking over. Disconnect it in Settings first." };
  if (blocker === "public.campaigns") return { problem: "A campaign was made. Hand-over is only for prepared ads; ask AdBrain to remove it." };
  if (blocker === "public.owner_alert_prefs") return { problem: "WhatsApp alerts were set up. The owner sets their own after taking over; ask AdBrain to remove them." };
  return { problem: "Payments were made on this account. Ask AdBrain before handing it over." };
}

/** The sheet's check rows: Meta and campaigns always shown; anything else that blocks gets its own row. */
export function transferChecks(blocker: string | null): TransferCheck[] {
  const rows: TransferCheck[] = [
    { label: "No Meta account connected", ok: !(blocker && META.has(blocker)) },
    { label: "No campaigns made", ok: blocker !== "public.campaigns" },
  ];
  for (const row of rows) if (!row.ok) row.problem = transferBlockerWords(blocker).problem;
  if (blocker && !META.has(blocker) && blocker !== "public.campaigns") rows.push({ label: "Nothing else set up", ok: false, problem: transferBlockerWords(blocker).problem });
  return rows;
}
