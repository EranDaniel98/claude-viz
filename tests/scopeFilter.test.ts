import { describe, it, expect } from "vitest";
import { filterScope } from "../web/src/lib/scopeFilter.js";
import type { SessionScope } from "../web/src/types.js";

const scope: SessionScope = {
  edited: {
    "src/auth/cookieStore.ts": { added: 6, removed: 2, reviewed: false },
    "src/billing/checkout.ts": { added: 1, removed: 0, reviewed: true },
  },
  created: ["src/auth/_fixtures/cookies.json"],
  deleted: ["old/stale.ts"],
  read: ["src/auth/session.ts", "README.md"],
};

describe("filterScope", () => {
  it("returns the full scope when query is empty", () => {
    const result = filterScope(scope, "");
    expect(result.matched).toBe(false);
    expect(result.edited).toEqual(scope.edited);
    expect(result.created).toEqual(scope.created);
    expect(result.read).toEqual(scope.read);
  });

  it("filters all categories by case-insensitive substring match", () => {
    const result = filterScope(scope, "Auth");
    expect(result.matched).toBe(true);
    expect(Object.keys(result.edited)).toEqual(["src/auth/cookieStore.ts"]);
    expect(result.created).toEqual(["src/auth/_fixtures/cookies.json"]);
    expect(result.deleted).toEqual([]);
    expect(result.read).toEqual(["src/auth/session.ts"]);
  });

  it("reports matched=false when the query yields zero hits", () => {
    const result = filterScope(scope, "nonexistent");
    expect(result.matched).toBe(false);
    expect(result.totalHits).toBe(0);
    expect(Object.keys(result.edited)).toEqual([]);
  });

  it("counts total hits across all categories", () => {
    const result = filterScope(scope, "auth");
    expect(result.totalHits).toBe(3); // 1 edited + 1 created + 1 read
  });
});
