import { describe, expect, it } from "vitest";
import { scriptSources, verdict } from "../scripts/first-load-js.mjs";

// #1850: the first-load JS of /, /login and /for/* must not grow by more than 10% against the base branch.
describe("first-load JS check (#1850)", () => {
  it("collects the page's own Next static scripts once each, in order", () => {
    const html = `<html><head><script src="/_next/static/chunks/a.js" async></script><link rel="preload" as="script" href="/_next/static/chunks/b.js">
      <script src="/_next/static/chunks/a.js"></script><script src="https://www.googletagmanager.com/x.js"></script><script>self.__next_f=[]</script></head></html>`;
    expect(scriptSources(html)).toEqual(["/_next/static/chunks/a.js", "/_next/static/chunks/b.js"]);
  });

  it("fails a page that grows more than 10% and 5 KB, and passes small or intended growth", () => {
    const base = { "/": 200_000, "/login": 150_000, "/for/solar": 120_000 };
    expect(verdict(base, { ...base, "/": 230_000 }).failed).toEqual(["/"]);
    expect(verdict(base, { ...base, "/login": 164_000 }).failed).toEqual([]);
    expect(verdict({ "/x": 10_000 }, { "/x": 14_000 }).failed).toEqual([]);
    expect(verdict(base, { ...base, "/": 400_000 }, { allow: true }).failed).toEqual([]);
    expect(verdict(base, { ...base, "/": 400_000 }, { allow: true }).rows[0]).toMatchObject({ page: "/", base: 200_000, head: 400_000, growth: 1 });
  });
});
