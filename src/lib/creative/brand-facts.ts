import type { Business } from "@/lib/types";

type FactBusiness = Pick<Business, "name" | "description" | "target_audience" | "usps" | "offers" | "locations">;

/** What the owner has told AdBrain about the business: the sources his typed claims are checked against (#280). */
export function brandFacts(business: FactBusiness, ...more: (string | null | undefined)[]): (string | null | undefined)[] {
  return [
    business.name, business.description, business.target_audience,
    ...(business.usps ?? []), ...(business.offers ?? []), ...(business.locations ?? []),
    ...more,
  ];
}
