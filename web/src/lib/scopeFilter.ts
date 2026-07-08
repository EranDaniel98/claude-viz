import type { SessionScope } from "../types.js";

export interface FilteredScope {
  matched: boolean;   // true if query yielded at least one hit
  totalHits: number;
  edited: SessionScope["edited"];
  created: string[];
  deleted: string[];
  read: string[];
}

export function filterScope(scope: SessionScope, query: string): FilteredScope {
  const q = query.trim().toLowerCase();
  if (!q) {
    return {
      matched: false,
      totalHits: 0,
      edited: scope.edited,
      created: scope.created,
      deleted: scope.deleted,
      read: scope.read,
    };
  }
  const hit = (p: string): boolean => p.toLowerCase().includes(q);
  const edited: SessionScope["edited"] = {};
  for (const [path, v] of Object.entries(scope.edited)) if (hit(path)) edited[path] = v;
  const created = scope.created.filter(hit);
  const deleted = scope.deleted.filter(hit);
  const read = scope.read.filter(hit);
  const totalHits = Object.keys(edited).length + created.length + deleted.length + read.length;
  return { matched: totalHits > 0, totalHits, edited, created, deleted, read };
}
