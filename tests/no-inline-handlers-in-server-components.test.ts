import { describe, it, expect } from "vitest";
import { readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";

// Regression test for a real production bug (2026-09): a Server Component
// (app/(app)/talleres/[groupId]/page.tsx) passed an inline closure —
// `onConfirm={() => archiveGroup(groupId)}` — as a prop to a Client
// Component (ConfirmAction). React/Next.js can't serialize an arbitrary
// closure across the server→client boundary, so *every* owner who opened
// a class page got "A server error occurred." The fix is `.bind(null,
// groupId)` on the Server Action itself (Next.js knows how to serialize a
// bound Server Action reference — a plain arrow function is not one).
//
// This isn't a one-route regression test — it's a static guard against
// the whole bug *class*, so the same mistake can't quietly reappear on a
// different page later. It scans every Server Component under app/ (any
// .tsx file without a top-of-file "use client") for an `on<Something>={`
// JSX prop whose value is an inline arrow function, and fails with the
// exact file/line if it finds one.

const APP_DIR = path.resolve(__dirname, "..", "app");

// event-handler-shaped prop assigned an inline arrow function, e.g.
// `onConfirm={() => ...}` or `onClick={(e) => ...}` — never valid on a
// Server Component, whether the target is a DOM element or a Client
// Component (an inline closure isn't a serializable Server Action
// reference; `.bind(null, ...)` on the action itself is).
const INLINE_HANDLER = /\bon[A-Z]\w*=\{\s*\([^)]*\)\s*=>/;

function listTsxFiles(dir: string): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(dir)) {
    const full = path.join(dir, entry);
    const stat = statSync(full);
    if (stat.isDirectory()) {
      out.push(...listTsxFiles(full));
    } else if (entry.endsWith(".tsx")) {
      out.push(full);
    }
  }
  return out;
}

function isClientComponent(source: string): boolean {
  // The directive must be the first statement in the file (ignoring
  // blank lines/comments), same rule Next.js itself uses.
  for (const rawLine of source.split("\n")) {
    const line = rawLine.trim();
    if (line === "" || line.startsWith("//")) continue;
    return line === '"use client";' || line === "'use client';" || line === '"use client"' || line === "'use client'";
  }
  return false;
}

describe("Server Components never pass an inline arrow function as an event-handler prop", () => {
  const files = listTsxFiles(APP_DIR);
  expect(files.length).toBeGreaterThan(0); // sanity check the scan itself isn't silently finding nothing

  for (const file of files) {
    const source = readFileSync(file, "utf-8");
    if (isClientComponent(source)) continue;

    it(`${path.relative(APP_DIR, file)} has no inline handler props`, () => {
      const offendingLines = source
        .split("\n")
        .map((line, i) => ({ line, number: i + 1 }))
        .filter(({ line }) => INLINE_HANDLER.test(line));

      if (offendingLines.length > 0) {
        const detail = offendingLines.map((o) => `  line ${o.number}: ${o.line.trim()}`).join("\n");
        throw new Error(
          `Server Component "${file}" passes an inline arrow function as an event-handler prop — ` +
            `not serializable across the server/client boundary. If the target is a Server Action, ` +
            `use \`.bind(null, arg)\` on the action itself instead of \`() => action(arg)\`.\n${detail}`
        );
      }
    });
  }
});
