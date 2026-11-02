/** #1792: the route-facing ownership check; the implementation moves here in Phase 2. */
export { requireOwnedBusiness } from "@/lib/meta/connection-access";
export { ConnectionAccessError } from "@/lib/meta/connection-access-error";
/** #625: the gate every managed route shares (managed accounts on for the user, signed in, Meta Connect open). */
export { managedRouteUser } from "@/lib/meta/managed-attempt";
