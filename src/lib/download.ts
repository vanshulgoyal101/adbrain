/**
 * Trigger a browser download for a Blob, correctly across browsers.
 *
 * The anchor must be attached to the document for Firefox to honour the click,
 * and the object URL must be revoked on a later tick — revoking it synchronously
 * after `click()` can abort the download before the browser has read the blob.
 */
export function downloadBlob(blob: Blob, filename: string): void {
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.rel = "noopener";
  a.style.display = "none";
  document.body.appendChild(a);
  a.click();
  a.remove();
  // Defer revocation so the download has started reading the blob.
  setTimeout(() => URL.revokeObjectURL(url), 10_000);
}
