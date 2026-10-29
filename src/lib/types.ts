/**
 * Database types for AdBrain, matching db/schema.sql. #1824: the definitions live in `src/lib/types/` by domain;
 * this file only re-exports them, so imports of "@/lib/types" are unchanged.
 *
 * These are hand-authored to mirror the schema. If you later run the Supabase
 * CLI (`supabase gen types typescript`), you can replace this file with the
 * generated output — the app only imports `Database` and the aliases below.
 */

export type * from "./types/json";
export type * from "./types/database";
export type * from "./types/business";
export type * from "./types/creative";
export type * from "./types/campaign";
export type * from "./types/meta";
export type * from "./types/leads";
export type * from "./types/payments";
export type * from "./types/system";
export type * from "./types/rows";
