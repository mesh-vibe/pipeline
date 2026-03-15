import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdirSync, writeFileSync, existsSync, readFileSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import {
  parseFrontmatter,
  parseGates,
  getPhaseGates,
  countGates,
  allGatesMet,
  nextPhase,
  prevPhase,
  slugify,
  NAME_REGEX,
  timeAgo,
  isNeedsInteractive,
  setNeedsInteractive,
  clearNeedsInteractive,
} from "../src/project.js";
import type { ProjectFrontmatter } from "../src/types.js";
import { generateProjectMd, generateBugfixProjectMd, generateDefectMd } from "../src/template.js";

describe("parseFrontmatter", () => {
  it("parses YAML frontmatter from markdown", () => {
    const content = `---
name: test-project
description: A test project
phase: design
priority: 3
---

# Test Project
`;
    const fm = parseFrontmatter(content);
    expect(fm.name).toBe("test-project");
    expect(fm.description).toBe("A test project");
    expect(fm.phase).toBe("design");
    expect(fm.priority).toBe("3");
  });

  it("returns empty object for no frontmatter", () => {
    const fm = parseFrontmatter("# No frontmatter");
    expect(fm).toEqual({});
  });

  it("handles empty values", () => {
    const content = `---
name: test
approved-at:
cancelled-reason:
---
`;
    const fm = parseFrontmatter(content);
    expect(fm.name).toBe("test");
    expect(fm["approved-at"]).toBe("");
    expect(fm["cancelled-reason"]).toBe("");
  });
});

describe("parseGates", () => {
  const projectMd = generateProjectMd("test", "A test", "cli", 3, "2026-03-04");

  it("parses all gate sections", () => {
    const sections = parseGates(projectMd);
    expect(sections.length).toBe(5);
    expect(sections[0].name).toBe("Design");
    expect(sections[1].name).toBe("Review");
    expect(sections[2].name).toBe("Implement");
    expect(sections[3].name).toBe("Test");
    expect(sections[4].name).toBe("Final Review");
  });

  it("parses design gates correctly", () => {
    const sections = parseGates(projectMd);
    const design = sections[0];
    expect(design.gates.length).toBe(3);
    expect(design.gates[0].label).toBe("Design doc complete");
    expect(design.gates[0].checked).toBe(false);
  });

  it("parses cli test gates", () => {
    const sections = parseGates(projectMd);
    const test = sections[3];
    expect(test.gates.length).toBe(4);
    expect(test.gates[0].label).toBe("CLI starts and shows help");
  });

  it("detects checked gates", () => {
    const content = projectMd.replace("- [ ] Design doc complete", "- [x] Design doc complete");
    const sections = parseGates(content);
    expect(sections[0].gates[0].checked).toBe(true);
  });
});

describe("getPhaseGates", () => {
  const projectMd = generateProjectMd("test", "A test", "cli", 3, "2026-03-04");

  it("returns gates for a given phase", () => {
    const gates = getPhaseGates(projectMd, "design");
    expect(gates.length).toBe(3);
  });

  it("handles final-review phase name", () => {
    const gates = getPhaseGates(projectMd, "final-review");
    expect(gates.length).toBe(4);
    expect(gates[0].label).toBe("All artifacts present and consistent");
  });

  it("returns empty array for unknown phase", () => {
    const gates = getPhaseGates(projectMd, "nonexistent");
    expect(gates).toEqual([]);
  });
});

describe("countGates", () => {
  const projectMd = generateProjectMd("test", "A test", "cli", 3, "2026-03-04");

  it("counts unchecked gates", () => {
    const { checked, total } = countGates(projectMd, "design");
    expect(checked).toBe(0);
    expect(total).toBe(3);
  });

  it("counts checked gates", () => {
    let content = projectMd;
    content = content.replace("- [ ] Design doc complete", "- [x] Design doc complete");
    content = content.replace("- [ ] Open questions resolved", "- [x] Open questions resolved");
    const { checked, total } = countGates(content, "design");
    expect(checked).toBe(2);
    expect(total).toBe(3);
  });
});

describe("allGatesMet", () => {
  const projectMd = generateProjectMd("test", "A test", "cli", 3, "2026-03-04");

  it("returns false when gates are unchecked", () => {
    expect(allGatesMet(projectMd, "design")).toBe(false);
  });

  it("returns true when all gates are checked", () => {
    let content = projectMd;
    content = content.replace("- [ ] Design doc complete", "- [x] Design doc complete");
    content = content.replace("- [ ] Open questions resolved", "- [x] Open questions resolved");
    content = content.replace("- [ ] Approach decided", "- [x] Approach decided");
    expect(allGatesMet(content, "design")).toBe(true);
  });
});

describe("nextPhase / prevPhase", () => {
  it("advances through phases", () => {
    expect(nextPhase("design")).toBe("review");
    expect(nextPhase("review")).toBe("implement");
    expect(nextPhase("implement")).toBe("test");
    expect(nextPhase("test")).toBe("final-review");
    expect(nextPhase("final-review")).toBeNull();
  });

  it("goes back through phases", () => {
    expect(prevPhase("design")).toBeNull();
    expect(prevPhase("review")).toBe("design");
    expect(prevPhase("implement")).toBe("review");
    expect(prevPhase("test")).toBe("implement");
    expect(prevPhase("final-review")).toBe("test");
  });
});

describe("NAME_REGEX", () => {
  it("accepts valid kebab-case names", () => {
    expect(NAME_REGEX.test("my-project")).toBe(true);
    expect(NAME_REGEX.test("a")).toBe(true);
    expect(NAME_REGEX.test("test-123")).toBe(true);
    expect(NAME_REGEX.test("multi-word-name")).toBe(true);
  });

  it("rejects invalid names", () => {
    expect(NAME_REGEX.test("MyProject")).toBe(false);
    expect(NAME_REGEX.test("123-test")).toBe(false);
    expect(NAME_REGEX.test("has spaces")).toBe(false);
    expect(NAME_REGEX.test("has_underscores")).toBe(false);
    expect(NAME_REGEX.test("-starts-with-dash")).toBe(false);
    expect(NAME_REGEX.test("")).toBe(false);
  });
});

describe("slugify", () => {
  it("converts text to slug", () => {
    expect(slugify("Hello World")).toBe("hello-world");
    expect(slugify("Fix the bug!")).toBe("fix-the-bug");
    expect(slugify("   spaces   ")).toBe("spaces");
  });
});

describe("timeAgo", () => {
  it("returns empty for empty string", () => {
    expect(timeAgo("")).toBe("");
  });

  it("returns empty for invalid date", () => {
    expect(timeAgo("not-a-date")).toBe("");
  });

  it("returns reasonable time ago", () => {
    const now = new Date();
    const tenMinAgo = new Date(now.getTime() - 10 * 60000).toISOString();
    expect(timeAgo(tenMinAgo)).toBe("10m ago");
  });
});

describe("generateProjectMd", () => {
  it("generates a project with correct frontmatter", () => {
    const md = generateProjectMd("my-project", "A cool project", "cli", 2, "2026-03-04");
    const fm = parseFrontmatter(md);
    expect(fm.name).toBe("my-project");
    expect(fm.description).toBe("A cool project");
    expect(fm["project-type"]).toBe("cli");
    expect(fm.phase).toBe("design");
    expect(fm.priority).toBe("2");
  });

  it("generates service test gates", () => {
    const md = generateProjectMd("my-svc", "A service", "service", 3, "2026-03-04");
    const gates = getPhaseGates(md, "test");
    expect(gates.some(g => g.label.includes("Service starts cleanly"))).toBe(true);
    expect(gates.some(g => g.label.includes("CLI starts"))).toBe(false);
  });

  it("generates library test gates", () => {
    const md = generateProjectMd("my-lib", "A library", "library", 3, "2026-03-04");
    const gates = getPhaseGates(md, "test");
    expect(gates.some(g => g.label.includes("npm pack succeeds"))).toBe(true);
  });

  it("generates heartbeat-task test gates", () => {
    const md = generateProjectMd("my-task", "A task", "heartbeat-task", 3, "2026-03-04");
    const gates = getPhaseGates(md, "test");
    expect(gates.some(g => g.label.includes("Timeout is respected"))).toBe(true);
  });
});

describe("generateBugfixProjectMd", () => {
  it("starts in implement phase", () => {
    const md = generateBugfixProjectMd("fix-bug", "Fix a bug", "cli", 3, "2026-03-04");
    const fm = parseFrontmatter(md);
    expect(fm.phase).toBe("implement");
  });

  it("has no design or review gates", () => {
    const md = generateBugfixProjectMd("fix-bug", "Fix a bug", "cli", 3, "2026-03-04");
    const designGates = getPhaseGates(md, "design");
    const reviewGates = getPhaseGates(md, "review");
    expect(designGates.length).toBe(0);
    expect(reviewGates.length).toBe(0);
  });
});

describe("generateDefectMd", () => {
  it("generates defect with correct frontmatter", () => {
    const md = generateDefectMd("Something broke", "high", "2026-03-04");
    const fm = parseFrontmatter(md);
    expect(fm.description).toBe("Something broke");
    expect(fm.severity).toBe("high");
    expect(fm.status).toBe("open");
  });
});

// --- Needs Interactive ---

describe("isNeedsInteractive", () => {
  // AC-4: isNeedsInteractive reads frontmatter
  it("returns true when needs-interactive is true", () => {
    const fm = { "needs-interactive": true } as ProjectFrontmatter;
    expect(isNeedsInteractive(fm)).toBe(true);
  });

  it("returns false when needs-interactive is false", () => {
    const fm = { "needs-interactive": false } as ProjectFrontmatter;
    expect(isNeedsInteractive(fm)).toBe(false);
  });

  // AC-14: Existing projects without needs-interactive fields parse correctly
  it("defaults to false for projects without the field", () => {
    const content = `---
name: old-project
phase: design
priority: 3
---

# Old Project
`;
    const raw = parseFrontmatter(content);
    // toFrontmatter defaults needs-interactive to false
    expect(raw["needs-interactive"]).toBeUndefined();
    const fm = { "needs-interactive": raw["needs-interactive"] === "true" } as ProjectFrontmatter;
    expect(isNeedsInteractive(fm)).toBe(false);
  });
});

describe("setNeedsInteractive", () => {
  let testDir: string;

  beforeEach(() => {
    testDir = join(tmpdir(), `pipeline-ni-test-${Date.now()}`);
    mkdirSync(testDir, { recursive: true });
  });

  afterEach(() => {
    rmSync(testDir, { recursive: true, force: true });
  });

  // AC-1: setNeedsInteractive sets frontmatter and creates context file
  it("sets frontmatter fields and creates context file", () => {
    const projectMd = `---
name: test-project
phase: implement
priority: 3
updated: 2026-03-10
needs-interactive: false
needs-interactive-reason:
---

# Test Project

## Gates

### Implement
- [ ] Builds clean
- [ ] Tests passing
`;
    writeFileSync(join(testDir, "project.md"), projectMd, "utf-8");

    setNeedsInteractive(testDir, "Cannot validate game mechanics");

    const content = readFileSync(join(testDir, "project.md"), "utf-8");
    const fm = parseFrontmatter(content);
    expect(fm["needs-interactive"]).toBe("true");
    expect(fm["needs-interactive-reason"]).toBe("Cannot validate game mechanics");
    expect(fm["updated"]).not.toBe("2026-03-10");

    // AC-2: needs-interactive.md follows template format
    expect(existsSync(join(testDir, "needs-interactive.md"))).toBe(true);
    const niContent = readFileSync(join(testDir, "needs-interactive.md"), "utf-8");
    expect(niContent).toContain("# Needs Interactive Session");
    expect(niContent).toContain("**Phase**: implement");
    expect(niContent).toContain("**Reason**: Cannot validate game mechanics");
    expect(niContent).toContain("## What was attempted");
    expect(niContent).toContain("## Why autonomous completion failed");
    expect(niContent).toContain("## What the human needs to provide or decide");
  });

  it("adds fields when they don't exist in frontmatter", () => {
    const projectMd = `---
name: test-project
phase: design
priority: 3
updated: 2026-03-10
---

# Test Project
`;
    writeFileSync(join(testDir, "project.md"), projectMd, "utf-8");

    setNeedsInteractive(testDir, "Missing source material");

    const content = readFileSync(join(testDir, "project.md"), "utf-8");
    const fm = parseFrontmatter(content);
    expect(fm["needs-interactive"]).toBe("true");
    expect(fm["needs-interactive-reason"]).toBe("Missing source material");
  });
});

describe("clearNeedsInteractive", () => {
  let testDir: string;

  beforeEach(() => {
    testDir = join(tmpdir(), `pipeline-ni-clear-${Date.now()}`);
    mkdirSync(testDir, { recursive: true });
  });

  afterEach(() => {
    rmSync(testDir, { recursive: true, force: true });
  });

  // AC-3: clearNeedsInteractive clears frontmatter and removes context file
  it("clears frontmatter fields and removes context file", () => {
    const projectMd = `---
name: test-project
phase: implement
priority: 3
updated: 2026-03-10
needs-interactive: true
needs-interactive-reason: Cannot validate game mechanics
---

# Test Project
`;
    writeFileSync(join(testDir, "project.md"), projectMd, "utf-8");
    writeFileSync(join(testDir, "needs-interactive.md"), "# Context", "utf-8");

    clearNeedsInteractive(testDir);

    const content = readFileSync(join(testDir, "project.md"), "utf-8");
    const fm = parseFrontmatter(content);
    expect(fm["needs-interactive"]).toBe("false");
    expect(fm["needs-interactive-reason"]).toBe("");
    expect(fm["updated"]).not.toBe("2026-03-10");
    expect(existsSync(join(testDir, "needs-interactive.md"))).toBe(false);
  });

  it("handles missing needs-interactive.md gracefully", () => {
    const projectMd = `---
name: test-project
phase: implement
priority: 3
updated: 2026-03-10
needs-interactive: true
needs-interactive-reason: Some reason
---

# Test Project
`;
    writeFileSync(join(testDir, "project.md"), projectMd, "utf-8");

    clearNeedsInteractive(testDir);

    const content = readFileSync(join(testDir, "project.md"), "utf-8");
    const fm = parseFrontmatter(content);
    expect(fm["needs-interactive"]).toBe("false");
  });
});
