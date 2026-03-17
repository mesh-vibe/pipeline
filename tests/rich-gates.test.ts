import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdirSync, writeFileSync, readFileSync, rmSync } from "node:fs";
import { join } from "node:path";
import { homedir } from "node:os";
import {
  parseGates,
  getPhaseGates,
  countGates,
  allGatesMet,
  checkGate,
  answerGate,
  uncheckPhaseGates,
} from "../src/project.js";
import { generateProjectMdFromTemplate } from "../src/template.js";
import { loadTemplateFromYaml } from "../src/flow.js";
import { parseFrontmatter } from "../src/project.js";

// --- Test content with all three gate types ---

const RICH_GATES_CONTENT = `---
name: rich-test
phase: review
priority: 3
---

# Rich Test

## Gates

### Design
- [x] Design doc complete
- [ ] Open questions resolved

### Review
- [?] Proceed with implementation?
- [?yes] Architecture approved?
- [?no] Requires security review?
- [>] Reviewer notes:
- [>] Approval reason: Looks good

### Implement
- [ ] Builds clean
- [x] Tests passing

## Phase History

- 2026-03-17 — Entered design phase
`;

// --- parseGates with yes-no markers ---

describe("parseGates — yes-no gates", () => {
  it("parses unanswered yes-no gate", () => {
    const sections = parseGates(RICH_GATES_CONTENT);
    const review = sections.find((s) => s.name === "Review")!;
    const gate = review.gates[0];
    expect(gate.type).toBe("yes-no");
    expect(gate.label).toBe("Proceed with implementation?");
    expect(gate.checked).toBe(false);
    expect(gate.value).toBeUndefined();
  });

  it("parses yes-no gate answered yes", () => {
    const sections = parseGates(RICH_GATES_CONTENT);
    const review = sections.find((s) => s.name === "Review")!;
    const gate = review.gates[1];
    expect(gate.type).toBe("yes-no");
    expect(gate.label).toBe("Architecture approved?");
    expect(gate.checked).toBe(true);
    expect(gate.value).toBe("yes");
  });

  it("parses yes-no gate answered no", () => {
    const sections = parseGates(RICH_GATES_CONTENT);
    const review = sections.find((s) => s.name === "Review")!;
    const gate = review.gates[2];
    expect(gate.type).toBe("yes-no");
    expect(gate.label).toBe("Requires security review?");
    expect(gate.checked).toBe(true);
    expect(gate.value).toBe("no");
  });
});

// --- parseGates with text markers ---

describe("parseGates — text gates", () => {
  it("parses text gate with no value", () => {
    const sections = parseGates(RICH_GATES_CONTENT);
    const review = sections.find((s) => s.name === "Review")!;
    const gate = review.gates[3];
    expect(gate.type).toBe("text");
    expect(gate.label).toBe("Reviewer notes:");
    expect(gate.checked).toBe(false);
    expect(gate.value).toBeUndefined();
  });

  it("parses text gate with value", () => {
    const sections = parseGates(RICH_GATES_CONTENT);
    const review = sections.find((s) => s.name === "Review")!;
    const gate = review.gates[4];
    expect(gate.type).toBe("text");
    expect(gate.label).toBe("Approval reason:");
    expect(gate.checked).toBe(true);
    expect(gate.value).toBe("Looks good");
  });
});

// --- countGates / allGatesMet with mixed gate types ---

describe("countGates with mixed gate types", () => {
  it("counts answered yes-no and filled text gates as checked", () => {
    const { checked, total } = countGates(RICH_GATES_CONTENT, "review");
    // [?] unanswered = unchecked, [?yes] = checked, [?no] = checked, [>] empty = unchecked, [>] filled = checked
    expect(total).toBe(5);
    expect(checked).toBe(3);
  });

  it("allGatesMet returns false for review (has unanswered gates)", () => {
    expect(allGatesMet(RICH_GATES_CONTENT, "review")).toBe(false);
  });

  it("allGatesMet returns false for implement (has unchecked checkbox)", () => {
    expect(allGatesMet(RICH_GATES_CONTENT, "implement")).toBe(false);
  });

  it("allGatesMet returns true when all mixed gates are answered", () => {
    const allAnswered = `---
name: test
phase: review
---

# Test

## Gates

### Review
- [?yes] Approved?
- [>] Notes: All good
- [x] Manual check done
`;
    expect(allGatesMet(allAnswered, "review")).toBe(true);
  });
});

// --- getPhaseGates with rich types ---

describe("getPhaseGates with rich gate types", () => {
  it("returns yes-no and text gates for review phase", () => {
    const gates = getPhaseGates(RICH_GATES_CONTENT, "review");
    expect(gates.length).toBe(5);
    const types = gates.map((g) => g.type);
    expect(types).toEqual(["yes-no", "yes-no", "yes-no", "text", "text"]);
  });

  it("returns checkbox gates for implement phase", () => {
    const gates = getPhaseGates(RICH_GATES_CONTENT, "implement");
    expect(gates.length).toBe(2);
    expect(gates.every((g) => g.type === "checkbox")).toBe(true);
  });
});

// --- renderGates (tested indirectly via generateProjectMdFromTemplate) ---

const TEMPLATE_WITH_RICH_GATES_YAML = `
name: rich-test-flow
description: A flow with all gate types for testing
default: false

phases:
  - name: review
    human-gate: true
    gates:
      - name: proceed
        label: "Proceed with implementation?"
        type: yes-no
        on-no: cancel
      - name: notes
        label: "Reviewer notes"
        type: text
      - name: standards-check
        label: Standards check passed

  - name: implement
    gates:
      - name: builds-clean
        label: Builds clean
      - name: approval
        label: "Final approval?"
        type: yes-no
        on-no: shelve

  - name: done
    terminal: true
    auto-archive: true
    gates:
      - name: complete
        label: Change is live

features:
  discussion-log: false
  defect-cycle: false
  bug-intake: false
  cancellation: true
`;

describe("renderGates — via generateProjectMdFromTemplate", () => {
  const template = loadTemplateFromYaml(TEMPLATE_WITH_RICH_GATES_YAML);

  it("renders yes-no gates with [?] marker", () => {
    const md = generateProjectMdFromTemplate(
      "test-render",
      "Test",
      "cli",
      3,
      "2026-03-17",
      template,
    );
    expect(md).toContain("- [?] Proceed with implementation?");
    expect(md).toContain("- [?] Final approval?");
  });

  it("renders text gates with [>] marker and colon", () => {
    const md = generateProjectMdFromTemplate(
      "test-render",
      "Test",
      "cli",
      3,
      "2026-03-17",
      template,
    );
    expect(md).toContain("- [>] Reviewer notes:");
  });

  it("renders checkbox gates with [ ] marker", () => {
    const md = generateProjectMdFromTemplate(
      "test-render",
      "Test",
      "cli",
      3,
      "2026-03-17",
      template,
    );
    expect(md).toContain("- [ ] Standards check passed");
    expect(md).toContain("- [ ] Builds clean");
    expect(md).toContain("- [ ] Change is live");
  });

  it("generated project round-trips through parseGates correctly", () => {
    const md = generateProjectMdFromTemplate(
      "test-render",
      "Test",
      "cli",
      3,
      "2026-03-17",
      template,
    );
    const sections = parseGates(md);
    expect(sections.length).toBe(3);

    const review = sections[0];
    expect(review.name).toBe("Review");
    expect(review.gates[0].type).toBe("yes-no");
    expect(review.gates[0].checked).toBe(false);
    expect(review.gates[1].type).toBe("text");
    expect(review.gates[1].checked).toBe(false);
    expect(review.gates[2].type).toBe("checkbox");
    expect(review.gates[2].checked).toBe(false);

    const implement = sections[1];
    expect(implement.gates[0].type).toBe("checkbox");
    expect(implement.gates[1].type).toBe("yes-no");
  });
});

// --- checkGate, answerGate, uncheckPhaseGates (filesystem-dependent) ---

describe("checkGate / answerGate / uncheckPhaseGates", () => {
  const testProjectName = `_test-rich-gates-${Date.now()}`;
  const flowsDir = join(homedir(), "mesh-vibe", "vibe-flow", "flows");
  const projectDir = join(flowsDir, "quick-fix", "active", testProjectName);
  const projectFile = join(projectDir, "project.md");

  const PROJECT_CONTENT = `---
name: ${testProjectName}
description: Test project for rich gates
flow: quick-fix
flow-version: 1
project-type: cli
phase: review
priority: 3
created: 2026-03-17
updated: 2026-03-17
approved-at:
stuck-threshold-minutes: 120
cancelled: false
cancelled-reason:
cancelled-at:
cancelled-from:
---

# Test Rich Gates

## Gates

### Review
- [ ] Code reviewed
- [?] Proceed with implementation?
- [>] Reviewer notes:

### Implement
- [ ] Builds clean
- [?] Ready for release?
- [>] Release version:

## Phase History

- 2026-03-17 — Entered review phase
`;

  beforeEach(() => {
    mkdirSync(projectDir, { recursive: true });
    writeFileSync(projectFile, PROJECT_CONTENT, "utf-8");
  });

  afterEach(() => {
    rmSync(projectDir, { recursive: true, force: true });
  });

  // --- checkGate ---

  describe("checkGate", () => {
    it("checks a checkbox gate", () => {
      checkGate(testProjectName, "Code reviewed");
      const content = readFileSync(projectFile, "utf-8");
      expect(content).toContain("- [x] Code reviewed");
      expect(content).not.toContain("- [ ] Code reviewed");
    });

    it("does not affect other gates", () => {
      checkGate(testProjectName, "Code reviewed");
      const content = readFileSync(projectFile, "utf-8");
      expect(content).toContain("- [ ] Builds clean");
      expect(content).toContain("- [?] Proceed with implementation?");
    });
  });

  // --- answerGate (yes-no) ---

  describe("answerGate — yes-no", () => {
    it("answers a yes-no gate with yes", () => {
      answerGate(testProjectName, "Proceed with implementation?", "yes", "yes-no");
      const content = readFileSync(projectFile, "utf-8");
      expect(content).toContain("- [?yes] Proceed with implementation?");
      expect(content).not.toContain("- [?] Proceed with implementation?");
    });

    it("answers a yes-no gate with no", () => {
      answerGate(testProjectName, "Proceed with implementation?", "no", "yes-no");
      const content = readFileSync(projectFile, "utf-8");
      expect(content).toContain("- [?no] Proceed with implementation?");
    });

    it("only answers the targeted gate", () => {
      answerGate(testProjectName, "Proceed with implementation?", "yes", "yes-no");
      const content = readFileSync(projectFile, "utf-8");
      // The other yes-no gate should be untouched
      expect(content).toContain("- [?] Ready for release?");
    });
  });

  // --- answerGate (text) ---

  describe("answerGate — text", () => {
    it("fills in a text gate", () => {
      answerGate(testProjectName, "Reviewer notes:", "All looks good", "text");
      const content = readFileSync(projectFile, "utf-8");
      expect(content).toContain("- [>] Reviewer notes: All looks good");
    });

    it("only fills the targeted text gate", () => {
      answerGate(testProjectName, "Reviewer notes:", "LGTM", "text");
      const content = readFileSync(projectFile, "utf-8");
      expect(content).toContain("- [>] Release version:");
      expect(content).not.toContain("- [>] Release version: LGTM");
    });

    it("overwrites previous text value", () => {
      answerGate(testProjectName, "Reviewer notes:", "First draft", "text");
      answerGate(testProjectName, "Reviewer notes:", "Final version", "text");
      const content = readFileSync(projectFile, "utf-8");
      expect(content).toContain("- [>] Reviewer notes: Final version");
      expect(content).not.toContain("First draft");
    });
  });

  // --- uncheckPhaseGates ---

  describe("uncheckPhaseGates", () => {
    it("resets checkbox gates to unchecked", () => {
      checkGate(testProjectName, "Code reviewed");
      const before = readFileSync(projectFile, "utf-8");
      expect(before).toContain("- [x] Code reviewed");

      uncheckPhaseGates(testProjectName, "review");
      const after = readFileSync(projectFile, "utf-8");
      expect(after).toContain("- [ ] Code reviewed");
    });

    it("resets yes-no gates to unanswered", () => {
      answerGate(testProjectName, "Proceed with implementation?", "yes", "yes-no");
      const before = readFileSync(projectFile, "utf-8");
      expect(before).toContain("- [?yes] Proceed with implementation?");

      uncheckPhaseGates(testProjectName, "review");
      const after = readFileSync(projectFile, "utf-8");
      expect(after).toContain("- [?] Proceed with implementation?");
    });

    it("clears text gate values", () => {
      answerGate(testProjectName, "Reviewer notes:", "Some notes", "text");
      const before = readFileSync(projectFile, "utf-8");
      expect(before).toContain("- [>] Reviewer notes: Some notes");

      uncheckPhaseGates(testProjectName, "review");
      const after = readFileSync(projectFile, "utf-8");
      expect(after).toMatch(/- \[>\] Reviewer notes:$/m);
      expect(after).not.toContain("Some notes");
    });

    it("resets all gate types in a phase at once", () => {
      // Set all gates in review
      checkGate(testProjectName, "Code reviewed");
      answerGate(testProjectName, "Proceed with implementation?", "yes", "yes-no");
      answerGate(testProjectName, "Reviewer notes:", "Done", "text");

      // Verify all are set
      const before = readFileSync(projectFile, "utf-8");
      expect(before).toContain("- [x] Code reviewed");
      expect(before).toContain("- [?yes] Proceed with implementation?");
      expect(before).toContain("- [>] Reviewer notes: Done");

      // Reset review phase
      uncheckPhaseGates(testProjectName, "review");
      const after = readFileSync(projectFile, "utf-8");
      expect(after).toContain("- [ ] Code reviewed");
      expect(after).toContain("- [?] Proceed with implementation?");
      expect(after).toMatch(/- \[>\] Reviewer notes:$/m);
    });

    it("does not affect gates in other phases", () => {
      checkGate(testProjectName, "Builds clean");
      answerGate(testProjectName, "Ready for release?", "yes", "yes-no");
      answerGate(testProjectName, "Release version:", "1.0.0", "text");

      uncheckPhaseGates(testProjectName, "review");

      const after = readFileSync(projectFile, "utf-8");
      // Implement phase should be untouched
      expect(after).toContain("- [x] Builds clean");
      expect(after).toContain("- [?yes] Ready for release?");
      expect(after).toContain("- [>] Release version: 1.0.0");
    });
  });
});

// --- Edge cases ---

describe("parseGates edge cases", () => {
  it("handles content with no gates section", () => {
    const content = `---
name: test
phase: design
---

# Test

No gates here.
`;
    expect(parseGates(content)).toEqual([]);
  });

  it("handles empty gate sections", () => {
    const content = `---
name: test
phase: design
---

# Test

## Gates

### Design

### Review

## Phase History
`;
    const sections = parseGates(content);
    expect(sections.length).toBe(2);
    expect(sections[0].gates).toEqual([]);
    expect(sections[1].gates).toEqual([]);
  });

  it("handles text gate label with special regex characters", () => {
    const content = `---
name: test
phase: review
---

# Test

## Gates

### Review
- [>] Version (semver):
- [>] Test result [pass/fail]:
`;
    const sections = parseGates(content);
    const review = sections[0];
    expect(review.gates.length).toBe(2);
    expect(review.gates[0].label).toBe("Version (semver):");
    expect(review.gates[1].label).toBe("Test result [pass/fail]:");
  });
});
