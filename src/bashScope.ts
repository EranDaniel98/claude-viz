// Best-effort filesystem-mutation extraction from Bash command strings.
// Catches what `Edit`/`Write` hooks miss: rm, mv, cp, touch, mkdir, sed -i,
// dd, and `>` / `>>` redirections. We never *execute* the command — this is
// purely lexical analysis of `tool_input.command` strings.
//
// Limitations are intentional. We don't expand globs, don't follow variables,
// don't track command substitutions. A path that came out of `$(find ...)`
// won't be captured. The principle is: a lying scope card is worse than an
// incomplete one — only report what we can read directly from the command.

export interface BashMutations {
  created: string[];
  deleted: string[];
  edited: string[];
}

export function parseBashMutations(command: string): BashMutations {
  const out: BashMutations = { created: [], deleted: [], edited: [] };
  for (const segment of splitOnOperators(command)) {
    const tokens = tokenize(segment);
    if (tokens.length === 0) continue;
    extractRedirections(tokens, out);
    extractCommandMutations(tokens, out);
  }
  return {
    created: dedupe(out.created),
    deleted: dedupe(out.deleted),
    edited:  dedupe(out.edited),
  };
}

const dedupe = (xs: string[]): string[] => Array.from(new Set(xs));

// Split on `&&`, `||`, `;`, `|` outside quotes. Each segment parses independently.
// Pipelines lose precision (`cmd | tee file` looks like two commands) but that's
// acceptable for scope tracking.
function splitOnOperators(s: string): string[] {
  const out: string[] = [];
  let buf = "";
  let q: '"' | "'" | null = null;
  let escape = false;
  const flush = () => { if (buf.trim()) out.push(buf); buf = ""; };
  for (let i = 0; i < s.length; i++) {
    const c = s[i];
    if (escape) { buf += c; escape = false; continue; }
    if (c === "\\" && q !== "'") { buf += c; escape = true; continue; }
    if (q) {
      if (c === q) q = null;
      buf += c;
      continue;
    }
    if (c === '"' || c === "'") { q = c; buf += c; continue; }
    const two = s.slice(i, i + 2);
    if (two === "&&" || two === "||") { flush(); i++; continue; }
    if (c === ";" || c === "|") { flush(); continue; }
    buf += c;
  }
  flush();
  return out;
}

// Whitespace-split with quote handling. Returns tokens with quotes stripped.
function tokenize(s: string): string[] {
  const out: string[] = [];
  let buf = "";
  let q: '"' | "'" | null = null;
  let escape = false;
  let inToken = false;
  const flush = () => { if (inToken) { out.push(buf); buf = ""; inToken = false; } };
  for (let i = 0; i < s.length; i++) {
    const c = s[i];
    if (escape) { buf += c; escape = false; inToken = true; continue; }
    if (c === "\\" && q !== "'") { escape = true; i++; if (i < s.length) { buf += s[i]; inToken = true; } continue; }
    if (q) {
      if (c === q) q = null;
      else buf += c;
      inToken = true;
      continue;
    }
    if (c === '"' || c === "'") { q = c; inToken = true; continue; }
    if (/\s/.test(c)) { flush(); continue; }
    buf += c;
    inToken = true;
  }
  flush();
  return out;
}

const REDIR_TOKEN_RE = /^[0-9]*(&?>>?|&>)$/;
const REDIR_ATTACHED_RE = /^([0-9]*(?:&?>>?|&>))(.+)$/;

function extractRedirections(tokens: string[], out: BashMutations): void {
  for (let i = 0; i < tokens.length; i++) {
    const t = tokens[i];
    // Pure redirection operator (`>`, `>>`, `2>`, `&>`) — target is the
    // next token. Check this BEFORE the attached form, otherwise the
    // attached regex backtracks `>>` into `>` (op) + `>` (path).
    if (REDIR_TOKEN_RE.test(t)) {
      if (i + 1 < tokens.length) {
        const target = tokens[i + 1];
        if (target && !target.startsWith("&")) out.created.push(target);
        tokens[i] = "";
        tokens[i + 1] = "";
        i++;
      } else {
        tokens[i] = "";
      }
      continue;
    }
    // Attached form: `>file`, `>>file`, `2>file`. The target group must
    // start with a path-like char to avoid swallowing fd-dup forms.
    const attached = t.match(REDIR_ATTACHED_RE);
    if (attached && attached[2] && !attached[2].startsWith("&")) {
      out.created.push(attached[2]);
      tokens[i] = "";
    }
  }
  for (let r = tokens.length - 1; r >= 0; r--) if (tokens[r] === "") tokens.splice(r, 1);
}

function extractCommandMutations(tokens: string[], out: BashMutations): void {
  // Skip leading env assignments: `FOO=bar baz arg`.
  let i = 0;
  while (i < tokens.length && /^[A-Za-z_][A-Za-z0-9_]*=/.test(tokens[i])) i++;
  if (i >= tokens.length) return;
  const verb = basenameOf(tokens[i]);
  const args = tokens.slice(i + 1);

  switch (verb) {
    case "rm":
    case "rmdir":
    case "unlink": {
      out.deleted.push(...nonFlag(args));
      break;
    }
    case "mv": {
      const paths = nonFlag(args);
      if (paths.length >= 2) {
        const dst = paths[paths.length - 1];
        out.deleted.push(...paths.slice(0, -1));
        out.created.push(dst);
      }
      break;
    }
    case "cp":
    case "install": {
      const paths = nonFlag(args);
      if (paths.length >= 2) out.created.push(paths[paths.length - 1]);
      break;
    }
    case "touch":
    case "mkdir": {
      out.created.push(...nonFlag(args));
      break;
    }
    case "sed": {
      // sed is the only verb where a non-flag arg can be a script, not a file.
      // Honor `-e <script>` and `-f <scriptfile>`; treat the first remaining
      // positional as the script and the rest as targets. Only report when
      // `-i` (in-place) is set.
      let hasInPlace = false;
      const positionals: string[] = [];
      for (let k = 0; k < args.length; k++) {
        const a = args[k];
        if (a === "-i" || a === "--in-place" || /^-i\..+/.test(a)) { hasInPlace = true; continue; }
        if (a === "-e" || a === "-f") { k++; continue; }
        if (a.startsWith("-")) continue;
        positionals.push(a);
      }
      if (hasInPlace && positionals.length > 0) {
        // First positional is the sed script; the rest are files.
        out.edited.push(...positionals.slice(1));
      }
      break;
    }
    case "dd": {
      for (const a of args) {
        const m = a.match(/^of=(.+)$/);
        if (m) out.created.push(m[1]);
      }
      break;
    }
  }
}

const nonFlag = (args: string[]): string[] => args.filter((a) => !a.startsWith("-"));

function basenameOf(p: string): string {
  const i = Math.max(p.lastIndexOf("/"), p.lastIndexOf("\\"));
  return i >= 0 ? p.slice(i + 1) : p;
}
