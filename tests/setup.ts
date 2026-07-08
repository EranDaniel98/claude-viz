import { afterEach } from "vitest";
import { cleanup } from "@testing-library/react";
import "@testing-library/jest-dom/vitest";

// With vitest's `globals: false`, @testing-library/react's auto-cleanup
// hook can't register itself — registering it manually here means every
// rendered tree is torn down between tests, so query helpers don't see
// stale DOM from prior renders.
afterEach(() => { cleanup(); });
