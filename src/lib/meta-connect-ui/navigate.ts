/** Send this tab to Meta's login; used when the popup is blocked or never shows (#474). */
export function continueInTab(url: string): void {
  window.location.assign(url);
}
