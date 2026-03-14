import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { mkdirSync, writeFileSync, existsSync, readFileSync, rmSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { execSync } from "node:child_process";
import { homedir } from "node:os";
import { runSupervise } from "../src/supervise-runner.js";
import { timestamp } from "../src/project.js";

// Integration tests use the real pipeline directory structure.
// We create/cleanup a test project in the actual vibe-flow directory.
const PIPELINE_DIR = join(
  process.env.HOME || "/tmp",
  "mesh-vibe",
  "vibe-flow",
);
const ACTIVE_DIR = join(PIPELINE_DIR, "flows", "sdlc-point-release-v1-0", "active");
const ARCHIVE_DIR = join(PIPELINE_DIR, "flows", "sdlc-point-release-v1-0", "archive");
const TEST_PREFIX = "sv-test-";

function testProjectName(suffix: string): string {
  return `${TEST_PREFIX}${suffix}`;
}

function testProjectDir(suffix: string): string {
  return join(ACTIVE_DIR, testProjectName(suffix));
}

function createTestProject(
  suffix: string,
  opts: {
    phase?: string;
    priority?: number;
    updatedMinutesAgo?: number;
    allDesignGatesMet?: boolean;
    allImplementGatesMet?: boolean;
    allFinalReviewGatesMet?: boolean;
    cancelled?: boolean;
  } = {},
): string {
  const name = testProjectName(suffix);
  const dir = join(ACTIVE_DIR, name);
  mkdirSync(dir, { recursive: true });

  const phase = opts.phase || "design";
  const priority = opts.priority || 3;
  const now = new Date();
  const updated = opts.updatedMinutesAgo !== undefined
    ? new Date(now.getTime() - opts.updatedMinutesAgo * 60000)
    : now;
  const updatedStr = `${updated.toISOString().slice(0, 10)} ${updated.toTimeString().slice(0, 5)}`;
  const createdStr = "2026-03-01";
  const cancelled = opts.cancelled || false;

  const designChecked = opts.allDesignGatesMet ? "x" : " ";
  const implementChecked = opts.allImplementGatesMet ? "x" : " ";
  const frChecked = opts.allFinalReviewGatesMet ? "x" : " ";

  const content = `---
name: ${name}
description: Test project ${suffix}
flow: sdlc-point-release-v1-0
flow-version: 1
project-type: cli
phase: ${phase}
priority: ${priority}
created: ${createdStr}
updated: ${updatedStr}
approved-at:
stuck-threshold-minutes: 120
cancelled: ${cancelled}
cancelled-reason:
cancelled-at:
cancelled-from:
---

# ${name}

Test project for supervisor integration tests.

## Gates

### Design
- [${designChecked}] Design doc complete
- [${designChecked}] Open questions resolved
- [${designChecked}] Approach decided

### Review
- [ ] use-cases.md produced (happy path, edge cases, error scenarios)
- [ ] cli-spec.md produced (commands, flags, output, examples)
- [ ] acceptance-criteria.md produced (testable Given/When/Then statements)
- [ ] No ambiguity remaining in design
- [ ] Test coverage target specified
- [ ] Owner sign-off (DO NOT check this — requires human approval via \`pipeline approve\`)

### Implement
- [${implementChecked}] Builds clean
- [${implementChecked}] Tests passing
- [${implementChecked}] Coverage target met
- [${implementChecked}] Standards-bot passes

### Test
- [ ] Tests pass
- [ ] CLI starts and shows help
- [ ] Smoke test passed (core commands)
- [ ] Integration test passed
- [ ] All acceptance criteria verified

### Final Review
- [${frChecked}] All artifacts present and consistent
- [${frChecked}] Acceptance criteria mapped to test results
- [${frChecked}] No orphaned files or TODOs
- [${frChecked}] final-review.md written

## Phase History

- 2026-03-01 — Entered design phase
`;

  writeFileSync(join(dir, "project.md"), content, "utf-8");
  writeFileSync(join(dir, "discussion.md"), "# Discussion Log\n", "utf-8");
  return name;
}

function cleanup(): void {
  // Clean up test projects from active and archive
  for (const baseDir of [ACTIVE_DIR, ARCHIVE_DIR]) {
    if (!existsSync(baseDir)) continue;
    try {
      const entries = require("node:fs").readdirSync(baseDir);
      for (const entry of entries) {
        if (entry.startsWith(TEST_PREFIX)) {
          rmSync(join(baseDir, entry), { recursive: true, force: true });
        }
      }
    } catch {
      // ignore
    }
  }
}

describe("runSupervise integration", () => {
  beforeEach(() => {
    cleanup();
  });

  afterEach(() => {
    cleanup();
  });

  // AC-23: Empty active directory
  it("handles no projects gracefully", () => {
    // Don't create any test projects — supervisor should still work
    const result = runSupervise(
      { limit: 3, promptQueue: false, notify: false, queue: true },
      true,
      false,
      false,
    );
    // Should complete without error (may have other real projects)
    expect(result).toBeDefined();
    expect(result.actions).toBeDefined();
  });

  // AC-1: Advance project when all gates met
  it("advances project when all design gates met", () => {
    const name = createTestProject("advance", {
      phase: "design",
      allDesignGatesMet: true,
      updatedMinutesAgo: 5,
    });

    const result = runSupervise(
      { limit: 3, promptQueue: false, notify: false, queue: true },
      false, // not dry-run — actually advance
      false,
      false,
    );

    const advanceAction = result.actions.find(
      (a) => a.type === "advance" && a.project === name,
    );
    expect(advanceAction).toBeDefined();

    // Verify the project was actually advanced
    const projectFile = join(testProjectDir("advance"), "project.md");
    const content = readFileSync(projectFile, "utf-8");
    expect(content).toMatch(/phase: review/);
  });

  // AC-16: Dry run
  it("dry run does not modify files", () => {
    const name = createTestProject("dryrun", {
      phase: "design",
      allDesignGatesMet: true,
      updatedMinutesAgo: 5,
    });

    const result = runSupervise(
      { limit: 3, promptQueue: false, notify: false, queue: true },
      true, // dry-run
      false,
      false,
    );

    const advanceAction = result.actions.find(
      (a) => a.type === "advance" && a.project === name,
    );
    expect(advanceAction).toBeDefined();

    // Verify the project was NOT advanced (still design)
    const projectFile = join(testProjectDir("dryrun"), "project.md");
    const content = readFileSync(projectFile, "utf-8");
    expect(content).toMatch(/phase: design/);
  });

  // AC-6: Skip active project
  it("skips recently updated project", () => {
    const name = createTestProject("active", {
      phase: "implement",
      updatedMinutesAgo: 5, // just 5 min ago, threshold is 120
    });

    const result = runSupervise(
      { limit: 3, promptQueue: false, notify: false, queue: true },
      true,
      false,
      false,
    );

    const skipAction = result.actions.find(
      (a) => a.type === "skip" && a.project === name && "reason" in a && a.reason === "active",
    );
    expect(skipAction).toBeDefined();
  });

  // AC-8: Skip cancelled project
  it("skips cancelled project", () => {
    const name = createTestProject("cancelled", {
      phase: "implement",
      cancelled: true,
    });

    const result = runSupervise(
      { limit: 3, promptQueue: false, notify: false, queue: true },
      true,
      false,
      false,
    );

    const skipAction = result.actions.find(
      (a) => a.type === "skip" && a.project === name && "reason" in a && a.reason === "cancelled",
    );
    expect(skipAction).toBeDefined();
  });

  // AC-17: JSON output (verify result structure)
  it("returns valid result structure", () => {
    createTestProject("json", { phase: "implement", updatedMinutesAgo: 5 });

    const result = runSupervise(
      { limit: 3, promptQueue: false, notify: false, queue: true },
      true,
      false,
      true, // JSON mode
    );

    expect(typeof result.projects).toBe("number");
    expect(typeof result.advanced).toBe("number");
    expect(typeof result.queued).toBe("number");
    expect(typeof result.archived).toBe("number");
    expect(typeof result.skippedActive).toBe("number");
    expect(typeof result.skippedLimit).toBe("number");
    expect(Array.isArray(result.errors)).toBe(true);
    expect(Array.isArray(result.actions)).toBe(true);
  });

  // AC-2: Archive project at terminal phase
  it("archives project when final-review gates all met", () => {
    const name = createTestProject("archive", {
      phase: "final-review",
      allFinalReviewGatesMet: true,
      updatedMinutesAgo: 5,
    });

    const result = runSupervise(
      { limit: 3, promptQueue: false, notify: false, queue: true },
      false,
      false,
      false,
    );

    const archiveAction = result.actions.find(
      (a) => a.type === "archive" && a.project === name,
    );
    expect(archiveAction).toBeDefined();

    // Verify the project was moved to archive
    expect(existsSync(testProjectDir("archive"))).toBe(false);
    expect(existsSync(join(ARCHIVE_DIR, name))).toBe(true);
  });

  // AC-21: Malformed project survives
  it("handles malformed project without crashing", () => {
    // Create a valid project and a malformed one
    const goodName = createTestProject("good", {
      phase: "implement",
      updatedMinutesAgo: 5,
    });

    // Create malformed project (bad frontmatter)
    const badDir = join(ACTIVE_DIR, testProjectName("bad"));
    mkdirSync(badDir, { recursive: true });
    writeFileSync(
      join(badDir, "project.md"),
      "not valid frontmatter at all\n## Gates\n",
      "utf-8",
    );

    const result = runSupervise(
      { limit: 3, promptQueue: false, notify: false, queue: true },
      true,
      false,
      false,
    );

    // The good project should still be processed
    const goodAction = result.actions.find(
      (a) => a.project === goodName,
    );
    expect(goodAction).toBeDefined();
  });

  // AC-5: Queue work for stuck project (dry run to avoid actually queuing)
  it("decides to queue work for stuck project", () => {
    const name = createTestProject("stuck", {
      phase: "implement",
      updatedMinutesAgo: 200, // way past 120min threshold
    });

    const result = runSupervise(
      { limit: 3, promptQueue: false, notify: false, queue: true },
      true, // dry run so we don't actually call prompt-queue
      false,
      false,
    );

    const queueAction = result.actions.find(
      (a) => a.type === "queue-work" && a.project === name,
    );
    expect(queueAction).toBeDefined();
    if (queueAction && queueAction.type === "queue-work") {
      expect(queueAction.phase).toBe("implement");
      expect(queueAction.prompt).toContain(name);
      expect(queueAction.prompt).toContain("implement");
    }
  });

  // AC-20: No-queue flag
  it("skips queuing when queue=false", () => {
    const name = createTestProject("noqueue", {
      phase: "implement",
      updatedMinutesAgo: 200,
    });

    const result = runSupervise(
      { limit: 3, promptQueue: false, notify: false, queue: false },
      true,
      false,
      false,
    );

    const skipAction = result.actions.find(
      (a) => a.project === name && a.type === "skip",
    );
    expect(skipAction).toBeDefined();
  });

  // AC-28: Exit code 0 (tested implicitly — no throw)
  it("completes without throwing", () => {
    createTestProject("ok", { phase: "implement", updatedMinutesAgo: 5 });

    expect(() => {
      runSupervise(
        { limit: 3, promptQueue: false, notify: false, queue: true },
        true,
        false,
        false,
      );
    }).not.toThrow();
  });

  // AC-18: Verbose output
  it("verbose mode includes per-project reasoning", () => {
    createTestProject("verbose", {
      phase: "design",
      allDesignGatesMet: true,
      updatedMinutesAgo: 5,
    });

    const result = runSupervise(
      { limit: 3, promptQueue: false, notify: false, queue: true },
      true,
      true, // verbose
      false,
    );

    expect(result).toBeDefined();
    // Just ensure it doesn't crash in verbose mode
    const action = result.actions.find(
      (a) => a.type === "advance" && a.project === testProjectName("verbose"),
    );
    expect(action).toBeDefined();
  });

  // AC-13: Skip prompt-queue without flag
  it("does not scan prompt-queue when flag is not set", () => {
    const result = runSupervise(
      { limit: 3, promptQueue: false, notify: false, queue: true },
      true,
      false,
      false,
    );

    // Should have no PQ-related actions
    const pqActions = result.actions.filter(
      (a) => a.type === "complete-pq" || a.type === "queue-step-pq",
    );
    expect(pqActions.length).toBe(0);
  });

  // Test prompt-queue integration path (just exercises the code path)
  it("runs with --prompt-queue flag without crashing", () => {
    const result = runSupervise(
      { limit: 3, promptQueue: true, notify: false, queue: true },
      true,
      false,
      false,
    );

    expect(result).toBeDefined();
    // The prompt-queue scan ran without crashing
    expect(typeof result.staleRemoved).toBe("number");
    expect(typeof result.duplicateRemoved).toBe("number");
  });

  // AC-5: Queue work for stuck project — non-dry-run (actually updates timestamp)
  it("updates project timestamp when queueing work (non-dry-run)", () => {
    const name = createTestProject("queue-real", {
      phase: "implement",
      updatedMinutesAgo: 200,
    });

    const beforeContent = readFileSync(
      join(testProjectDir("queue-real"), "project.md"),
      "utf-8",
    );
    const beforeUpdated = beforeContent.match(/^updated:\s*(.+)$/m)?.[1] ?? "";

    const result = runSupervise(
      { limit: 3, promptQueue: false, notify: false, queue: true },
      false, // NOT dry-run
      false,
      false,
    );

    const queueAction = result.actions.find(
      (a) => a.type === "queue-work" && a.project === name,
    );
    expect(queueAction).toBeDefined();

    // Verify timestamp was updated (AC-30 prevention)
    const afterContent = readFileSync(
      join(testProjectDir("queue-real"), "project.md"),
      "utf-8",
    );
    const afterUpdated = afterContent.match(/^updated:\s*(.+)$/m)?.[1] ?? "";
    expect(afterUpdated).not.toBe(beforeUpdated);
  });

  // AC-9: Respect limit with real projects
  it("limits queued work across projects", () => {
    createTestProject("lim-a", { phase: "implement", priority: 1, updatedMinutesAgo: 200 });
    createTestProject("lim-b", { phase: "implement", priority: 1, updatedMinutesAgo: 200 });
    createTestProject("lim-c", { phase: "implement", priority: 1, updatedMinutesAgo: 200 });

    const result = runSupervise(
      { limit: 1, promptQueue: false, notify: false, queue: true },
      true,
      false,
      false,
    );

    // Only 1 should be queued (limit=1)
    const queuedTestActions = result.actions.filter(
      (a) => a.type === "queue-work" && a.project.startsWith(TEST_PREFIX),
    );
    // The limit is global across all projects, so at most 1 total queued
    const totalQueued = result.actions.filter((a) => a.type === "queue-work").length;
    expect(totalQueued).toBeLessThanOrEqual(1);
  });

  // AC-3: Notify for human-gate (with notify enabled, dry-run to avoid side effects)
  it("generates notify action for review-phase project with all gates except owner sign-off", () => {
    const name = testProjectName("notify");
    const dir = join(ACTIVE_DIR, name);
    mkdirSync(dir, { recursive: true });

    // All review gates checked EXCEPT Owner sign-off
    const content = `---
name: ${name}
description: Test notify
flow: sdlc-point-release-v1-0
flow-version: 1
project-type: cli
phase: review
priority: 2
created: 2026-03-01
updated: ${timestamp()}
approved-at:
stuck-threshold-minutes: 120
cancelled: false
cancelled-reason:
cancelled-at:
cancelled-from:
---

# ${name}

## Gates

### Design
- [x] Design doc complete
- [x] Open questions resolved
- [x] Approach decided

### Review
- [x] use-cases.md produced (happy path, edge cases, error scenarios)
- [x] cli-spec.md produced (commands, flags, output, examples)
- [x] acceptance-criteria.md produced (testable Given/When/Then statements)
- [x] No ambiguity remaining in design
- [x] Test coverage target specified
- [ ] Owner sign-off (DO NOT check this — requires human approval via \`pipeline approve\`)

### Implement
- [ ] Builds clean
- [ ] Tests passing
- [ ] Coverage target met
- [ ] Standards-bot passes

### Test
- [ ] Tests pass
- [ ] CLI starts and shows help
- [ ] Smoke test passed (core commands)
- [ ] Integration test passed
- [ ] All acceptance criteria verified

### Final Review
- [ ] All artifacts present and consistent
- [ ] Acceptance criteria mapped to test results
- [ ] No orphaned files or TODOs
- [ ] final-review.md written

## Phase History

- 2026-03-01 — Entered design phase
`;
    writeFileSync(join(dir, "project.md"), content, "utf-8");
    writeFileSync(join(dir, "discussion.md"), "# Discussion Log\n", "utf-8");

    // Run with notify enabled but dry-run
    const result = runSupervise(
      { limit: 3, promptQueue: false, notify: true, queue: true },
      true,
      false,
      false,
    );

    const notifyAction = result.actions.find(
      (a) => a.type === "notify" && a.project === name,
    );
    expect(notifyAction).toBeDefined();
    if (notifyAction && notifyAction.type === "notify") {
      expect(notifyAction.priority).toBe("high");
      expect(notifyAction.message).toContain("ready for approval");
    }
  });

  // AC-19: No-notify flag suppresses notification
  it("suppresses notify when --no-notify", () => {
    const name = testProjectName("no-notify");
    const dir = join(ACTIVE_DIR, name);
    mkdirSync(dir, { recursive: true });

    const content = `---
name: ${name}
description: Test no-notify
flow: sdlc-point-release-v1-0
flow-version: 1
project-type: cli
phase: review
priority: 2
created: 2026-03-01
updated: ${timestamp()}
approved-at:
stuck-threshold-minutes: 120
cancelled: false
cancelled-reason:
cancelled-at:
cancelled-from:
---

# ${name}

## Gates

### Design
- [x] Design doc complete
- [x] Open questions resolved
- [x] Approach decided

### Review
- [x] use-cases.md produced (happy path, edge cases, error scenarios)
- [x] cli-spec.md produced (commands, flags, output, examples)
- [x] acceptance-criteria.md produced (testable Given/When/Then statements)
- [x] No ambiguity remaining in design
- [x] Test coverage target specified
- [ ] Owner sign-off (DO NOT check this — requires human approval via \`pipeline approve\`)

### Implement
- [ ] Builds clean
- [ ] Tests passing
- [ ] Coverage target met
- [ ] Standards-bot passes

### Test
- [ ] Tests pass
- [ ] CLI starts and shows help
- [ ] Smoke test passed (core commands)
- [ ] Integration test passed
- [ ] All acceptance criteria verified

### Final Review
- [ ] All artifacts present and consistent
- [ ] Acceptance criteria mapped to test results
- [ ] No orphaned files or TODOs
- [ ] final-review.md written

## Phase History

- 2026-03-01 — Entered design phase
`;
    writeFileSync(join(dir, "project.md"), content, "utf-8");
    writeFileSync(join(dir, "discussion.md"), "# Discussion Log\n", "utf-8");

    const result = runSupervise(
      { limit: 3, promptQueue: false, notify: false, queue: true },
      true,
      false,
      false,
    );

    // Should have a skip action for human-gate-pending, NOT a notify action
    const notifyAction = result.actions.find(
      (a) => a.type === "notify" && a.project === name,
    );
    expect(notifyAction).toBeUndefined();

    const skipAction = result.actions.find(
      (a) => a.type === "skip" && a.project === name,
    );
    expect(skipAction).toBeDefined();
  });
});

// --- Prompt-queue integration ---

describe("prompt-queue integration", () => {
  const PQ_DIR = join(homedir(), "mesh-vibe", "prompt-queue", "projects");
  const PQ_PREFIX = "sv-pq-test-";

  function cleanupPq(): void {
    if (!existsSync(PQ_DIR)) return;
    try {
      const entries = readdirSync(PQ_DIR);
      for (const entry of entries) {
        if (entry.startsWith(PQ_PREFIX)) {
          rmSync(join(PQ_DIR, entry), { force: true });
        }
      }
    } catch {
      // ignore
    }
  }

  beforeEach(() => {
    cleanupPq();
    // Also clean up pipeline test projects
    for (const baseDir of [ACTIVE_DIR, ARCHIVE_DIR]) {
      if (!existsSync(baseDir)) continue;
      try {
        const entries = readdirSync(baseDir);
        for (const entry of entries) {
          if (entry.startsWith(TEST_PREFIX)) {
            rmSync(join(baseDir, entry), { recursive: true, force: true });
          }
        }
      } catch {
        // ignore
      }
    }
  });

  afterEach(() => {
    cleanupPq();
  });

  // AC-11: Complete prompt-queue project (non-dry-run)
  it("completes pq project when all steps done", () => {
    if (!existsSync(PQ_DIR)) mkdirSync(PQ_DIR, { recursive: true });

    const name = `${PQ_PREFIX}complete`;
    const filePath = join(PQ_DIR, `${name}.md`);
    writeFileSync(filePath, `---
name: ${name}
description: Test complete PQ project
created: 2026-03-01
updated: 2026-03-01
stuck-threshold-minutes: 60
status:
---

# Steps

- [x] Step one
- [x] Step two
- [x] Step three
`, "utf-8");

    const result = runSupervise(
      { limit: 3, promptQueue: true, notify: false, queue: true },
      false, // NOT dry-run — exercises executeAction for complete-pq
      false,
      false,
    );

    const completePqAction = result.actions.find(
      (a) => a.type === "complete-pq" && a.project === name,
    );
    expect(completePqAction).toBeDefined();

    // The file should now have status: complete (if it still exists)
    if (existsSync(filePath)) {
      const content = readFileSync(filePath, "utf-8");
      expect(content).toMatch(/status:\s*complete/);
    }
  });

  // AC-12: Queue next step for stuck PQ project (non-dry-run)
  it("queues next step for stuck pq project", () => {
    if (!existsSync(PQ_DIR)) mkdirSync(PQ_DIR, { recursive: true });

    const name = `${PQ_PREFIX}stuck`;
    const filePath = join(PQ_DIR, `${name}.md`);
    // Updated 2h ago — clearly past 60min threshold
    writeFileSync(filePath, `---
name: ${name}
description: Test stuck PQ project
created: 2026-03-01
updated: 2026-03-01
stuck-threshold-minutes: 60
status:
---

# Steps

- [x] Step one
- [ ] Step two
- [ ] Step three
`, "utf-8");

    const result = runSupervise(
      { limit: 3, promptQueue: true, notify: false, queue: true },
      false, // NOT dry-run — exercises executeAction for queue-step-pq
      false,
      false,
    );

    const queueAction = result.actions.find(
      (a) => a.type === "queue-step-pq" && a.project === name,
    );
    expect(queueAction).toBeDefined();
    if (queueAction && queueAction.type === "queue-step-pq") {
      expect(queueAction.step).toBe("Step two");
    }

    // The updated field should be refreshed
    if (existsSync(filePath)) {
      const content = readFileSync(filePath, "utf-8");
      const updatedMatch = content.match(/^updated:\s*(.+)$/m);
      expect(updatedMatch).toBeTruthy();
      // Should no longer be "2026-03-01"
      expect(updatedMatch![1].trim()).not.toBe("2026-03-01");
    }
  });

  // AC-13: PQ projects NOT scanned without flag
  it("does not scan pq projects without --prompt-queue", () => {
    if (!existsSync(PQ_DIR)) mkdirSync(PQ_DIR, { recursive: true });

    const name = `${PQ_PREFIX}no-flag`;
    writeFileSync(join(PQ_DIR, `${name}.md`), `---
name: ${name}
description: Should not be scanned
created: 2026-03-01
updated: 2026-03-01
stuck-threshold-minutes: 60
status:
---

- [x] Step one
- [x] Step two
`, "utf-8");

    const result = runSupervise(
      { limit: 3, promptQueue: false, notify: false, queue: true },
      true,
      false,
      false,
    );

    const pqAction = result.actions.find((a) => a.project === name);
    expect(pqAction).toBeUndefined();
  });
});
