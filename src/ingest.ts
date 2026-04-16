import { createReadStream, statSync } from "fs";
import { createInterface } from "readline";
import chokidar, { FSWatcher } from "chokidar";

export interface TailHandle {
  close(): Promise<void>;
}

type LineHandler = (parsed: unknown) => void;

export async function tailJsonl(filePath: string, onEvent: LineHandler): Promise<TailHandle> {
  let offset = 0;
  let reading = false;
  let pending = false;

  const readFrom = async (from: number) => {
    if (reading) { pending = true; return; }
    reading = true;
    try {
      const { size } = statSync(filePath);
      if (size <= from) { offset = size; return; }

      await new Promise<void>((resolve, reject) => {
        const stream = createReadStream(filePath, { start: from, encoding: "utf8" });
        const rl = createInterface({ input: stream });
        let lastPos = from;

        rl.on("line", (line) => {
          lastPos += Buffer.byteLength(line, "utf8") + 1; // +1 for \n (approx; good enough)
          const trimmed = line.trim();
          if (!trimmed) return;
          try {
            onEvent(JSON.parse(trimmed));
          } catch {
            // malformed — skip silently (per spec: "a lying dashboard is worse than no dashboard";
            // bad input should never crash the tail)
          }
        });
        rl.on("close", () => {
          offset = lastPos;
          resolve();
        });
        stream.on("error", reject);
      });
    } finally {
      reading = false;
      if (pending) { pending = false; await readFrom(offset); }
    }
  };

  // Initial sweep
  try { await readFrom(0); } catch { /* file may not yet exist */ }

  const watcher: FSWatcher = chokidar.watch(filePath, {
    persistent: true,
    ignoreInitial: true,
    // Native fs events on Windows are unreliable for append-only JSONL;
    // polling is ~free on a single file and keeps behavior consistent.
    usePolling: true,
    interval: 100,
    awaitWriteFinish: { stabilityThreshold: 20, pollInterval: 10 },
  });

  watcher.on("add", () => readFrom(offset).catch(() => {}));
  watcher.on("change", () => readFrom(offset).catch(() => {}));

  // Wait for chokidar to report initial scan complete. Without this, callers
  // that append to the file immediately after tailJsonl() returns can write
  // before the watcher is armed, and the change event gets missed.
  await new Promise<void>((resolve) => watcher.once("ready", () => resolve()));

  return {
    async close() {
      await watcher.close();
    },
  };
}
