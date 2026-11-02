/** "Diwali offer: 10% off" becomes "10% off"; an empty suffix keeps the label. */
export function offerPhrase(offer: string): string {
  const trimmed = offer.trim().replace(/:+$/, "").trim();
  return (trimmed.split(":").pop() ?? "").trim() || trimmed;
}
