/**
 * Scrubs a recorded Meta tape before it is committed: every 10+ digit id (account, Page, Instagram,
 * lead form, WhatsApp phone id, campaign, ad set, ad, creative) becomes a stable fake number (same real
 * id → same fake, so replays still join up and numeric-id parsers still accept them), image hashes
 * become fake hashes, phone numbers keep only their last 4 digits and paging cursors are dropped.
 */
export function metaScrubber() {
  const ids = new Map<string, string>();
  const hashes = new Map<string, string>();
  const fakeId = (id: string) => {
    if (!ids.has(id)) ids.set(id, `9${String(ids.size + 1).padStart(id.length - 1, "0")}`);
    return ids.get(id)!;
  };
  const fakeHash = (hash: string) => {
    if (!hashes.has(hash)) hashes.set(hash, `${"f".repeat(24)}${String(hashes.size + 1).padStart(8, "0")}`);
    return hashes.get(hash)!;
  };
  const scrub = (text: string) => text
    .replace(/\+91[\d\s-]{10,14}/g, (phone) => `+91XXXXXX${phone.replace(/\D/g, "").slice(-4)}`)
    .replace(/"whatsapp_phone_number":\s*"\+?(\d+)"/g, (_all, digits: string) => `"whatsapp_phone_number":"+91XXXXXX${digits.slice(-4)}"`)
    .replace(/"(before|after)":\s*"[^"]+"/g, '"$1":"CURSOR"')
    .replace(/(?<![a-f0-9])[a-f0-9]{32}(?![a-f0-9])/g, fakeHash)
    .replace(/\d{10,}/g, fakeId);
  return { scrub, fakeId };
}
