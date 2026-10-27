import { describe, expect, it } from "vitest";
import { dumpRowCounts, realErrors } from "../scripts/restore-drill.mjs";

describe("restore drill (#884)", () => {
  it("counts each table's rows in a plain pg_dump", () => {
    const sql = ["SET x = 1;", "COPY public.leads (id, phone) FROM stdin;", "1\t+91", "2\t+92", "\\.", "",
      'COPY "auth"."users" (id) FROM stdin;', "\\.", "COPY private.meta_tokens (id) FROM stdin;", "a", "\\."].join("\n");
    expect(dumpRowCounts(sql)).toEqual({ "public.leads": 2, "auth.users": 0, "private.meta_tokens": 1 });
  });

  it("treats only lost schema or data as errors", () => {
    const stderr = ['psql:<stdin>:12: ERROR:  schema "public" already exists', 'psql:<stdin>:90: ERROR:  schema "private" does not exist', "NOTICE: x"].join("\n");
    expect(realErrors(stderr)).toEqual(['psql:<stdin>:90: ERROR:  schema "private" does not exist']);
  });
});
