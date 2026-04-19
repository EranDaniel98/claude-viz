import { describe, it, expect } from "vitest";
import { parseBashMutations } from "../src/bashScope.js";

describe("parseBashMutations", () => {
  it("returns empty for non-mutating commands", () => {
    expect(parseBashMutations("ls -la /tmp")).toEqual({ created: [], deleted: [], edited: [] });
    expect(parseBashMutations("git status")).toEqual({ created: [], deleted: [], edited: [] });
    expect(parseBashMutations("")).toEqual({ created: [], deleted: [], edited: [] });
  });

  it("captures rm and rm -rf as deletes", () => {
    expect(parseBashMutations("rm foo.txt")).toMatchObject({ deleted: ["foo.txt"] });
    expect(parseBashMutations("rm -rf build dist")).toMatchObject({ deleted: ["build", "dist"] });
    expect(parseBashMutations("rm -f /tmp/x.log")).toMatchObject({ deleted: ["/tmp/x.log"] });
  });

  it("captures mv as delete-source + create-dest", () => {
    const m = parseBashMutations("mv old.txt new.txt");
    expect(m.deleted).toEqual(["old.txt"]);
    expect(m.created).toEqual(["new.txt"]);
  });

  it("captures cp as create-dest only", () => {
    expect(parseBashMutations("cp src.ts dst.ts")).toMatchObject({ created: ["dst.ts"] });
  });

  it("captures touch and mkdir as creates", () => {
    expect(parseBashMutations("touch a.txt b.txt")).toMatchObject({ created: ["a.txt", "b.txt"] });
    expect(parseBashMutations("mkdir -p deep/nested/dir")).toMatchObject({ created: ["deep/nested/dir"] });
  });

  it("captures sed -i as edit, ignoring the script arg", () => {
    const m = parseBashMutations("sed -i 's/foo/bar/' file.txt");
    expect(m.edited).toEqual(["file.txt"]);
  });

  it("does NOT capture sed without -i (it's just a filter)", () => {
    expect(parseBashMutations("sed 's/foo/bar/' file.txt")).toMatchObject({ edited: [] });
  });

  it("captures sed -i with multiple files", () => {
    const m = parseBashMutations("sed -i 's/x/y/g' a.ts b.ts c.ts");
    expect(m.edited).toEqual(["a.ts", "b.ts", "c.ts"]);
  });

  it("captures > and >> redirections as creates", () => {
    expect(parseBashMutations("echo hi > out.txt")).toMatchObject({ created: ["out.txt"] });
    expect(parseBashMutations("cat file >> log.txt")).toMatchObject({ created: ["log.txt"] });
    expect(parseBashMutations("ls >foo.txt")).toMatchObject({ created: ["foo.txt"] });
  });

  it("ignores stderr-merge redirections (&> and 2>&1)", () => {
    // 2>&1 is fd dup, not a file write; "&" prefix on target means dup.
    const m = parseBashMutations("cmd 2>&1");
    expect(m.created).toEqual([]);
  });

  it("handles && / ; / | chained commands", () => {
    const m = parseBashMutations("rm a.txt && touch b.txt; echo x > c.txt | cat");
    expect(m.deleted).toEqual(["a.txt"]);
    expect(m.created).toEqual(["b.txt", "c.txt"]);
  });

  it("respects single and double quotes in tokens", () => {
    const m = parseBashMutations(`rm "file with space.txt" 'another one.log'`);
    expect(m.deleted).toEqual(["file with space.txt", "another one.log"]);
  });

  it("does not split on operators inside quotes", () => {
    const m = parseBashMutations(`echo "a && b" > out.txt`);
    expect(m.created).toEqual(["out.txt"]);
  });

  it("skips leading env assignments", () => {
    const m = parseBashMutations("FOO=bar BAZ=qux rm victim.txt");
    expect(m.deleted).toEqual(["victim.txt"]);
  });

  it("captures dd of=", () => {
    expect(parseBashMutations("dd if=/dev/zero of=/tmp/zeros bs=1M count=10"))
      .toMatchObject({ created: ["/tmp/zeros"] });
  });

  it("dedupes paths within a single command", () => {
    const m = parseBashMutations("rm foo.txt foo.txt");
    expect(m.deleted).toEqual(["foo.txt"]);
  });

  it("handles full-path verbs like /usr/bin/rm", () => {
    expect(parseBashMutations("/usr/bin/rm -f x.log")).toMatchObject({ deleted: ["x.log"] });
  });
});
