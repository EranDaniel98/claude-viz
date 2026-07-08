import { describe, it, expect } from "vitest";
import { diffLines } from "../src/state.js";

describe("diffLines", () => {
  it("identical strings have no diff", () => {
    expect(diffLines("foo", "foo")).toEqual({ added: 0, removed: 0 });
    expect(diffLines("a\nb\nc", "a\nb\nc")).toEqual({ added: 0, removed: 0 });
    expect(diffLines("", "")).toEqual({ added: 0, removed: 0 });
  });

  it("single-line single-char change reports 1 added + 1 removed (git semantics)", () => {
    expect(diffLines("x", "y")).toEqual({ added: 1, removed: 1 });
  });

  it("multi-line edit only counts changed lines, not all lines", () => {
    // Only the second line changed; line 1 is shared.
    const old = "hello world\nhow are you";
    const next = "hello world\nhow are you doing";
    expect(diffLines(old, next)).toEqual({ added: 1, removed: 1 });
  });

  it("inserting a line at the end", () => {
    expect(diffLines("a\nb", "a\nb\nc")).toEqual({ added: 1, removed: 0 });
  });

  it("deleting a line in the middle", () => {
    expect(diffLines("a\nb\nc", "a\nc")).toEqual({ added: 0, removed: 1 });
  });

  it("empty to non-empty is all-added", () => {
    expect(diffLines("", "a\nb")).toEqual({ added: 2, removed: 0 });
  });

  it("non-empty to empty is all-removed", () => {
    expect(diffLines("a\nb\nc", "")).toEqual({ added: 0, removed: 3 });
  });

  it("complete rewrite has no LCS", () => {
    expect(diffLines("a\nb", "c\nd")).toEqual({ added: 2, removed: 2 });
  });
});
