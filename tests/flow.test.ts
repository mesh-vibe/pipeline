import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdirSync, writeFileSync, existsSync, readFileSync, rmSync, cpSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import {
  loadTemplateFromYaml,
  loadTemplateFromFile,
  loadInstalledTemplate,
  listInstalledTemplates,
  validateTemplate,
  validateTemplateFile,
  installTemplate,
  uninstallTemplate,
  nextPhaseFromTemplate,
  prevPhaseFromTemplate,
  isEntryPoint,
  isTerminal,
  isHumanGate,
  shouldAutoArchive,
  evaluateSkipIf,
  resolveGates,
  resolveAllPhaseGates,
  checkVerifyGate,
  generateInitTemplate,
  forkTemplate,
} from "../src/flow.js";
import { generateProjectMdFromTemplate } from "../src/template.js";
import { parseFrontmatter, parseGates, getPhaseGates } from "../src/project.js";
import type { FlowTemplate } from "../src/flow-types.js";

// --- SDLC template YAML for tests ---

const SDLC_YAML = `
name: sdlc
description: Software development lifecycle
default: true

phases:
  - name: design
    worker: research-bot
    gates:
      - name: design-doc-complete
        label: Design doc complete
        verify: file-exists design.md
        artifacts: [design.md]
      - name: open-questions-resolved
        label: Open questions resolved
      - name: approach-decided
        label: Approach decided

  - name: review
    human-gate: true
    gates:
      - name: use-cases-produced
        label: use-cases.md produced
        verify: file-exists use-cases.md
      - name: owner-sign-off
        label: Owner sign-off

  - name: implement
    entry-point: true
    gates:
      - name: builds-clean
        label: Builds clean
      - name: tests-passing
        label: Tests passing
    gate-variants:
      by: project-type
      cli:
        - name: cli-help
          label: CLI starts and shows help

  - name: test
    skip-if: project-type == docs
    gates:
      - name: tests-pass
        label: Tests pass
    gate-variants:
      by: project-type
      cli:
        - name: smoke-test
          label: Smoke test passed
      library:
        - name: npm-pack
          label: npm pack succeeds

  - name: final-review
    terminal: true
    gates:
      - name: artifacts-present
        label: All artifacts present
      - name: final-review-written
        label: final-review.md written
        verify: file-exists final-review.md

features:
  discussion-log: true
  defect-cycle: true
  bug-intake: true
  cancellation: true

workers:
  research-bot:
    prompt: workers/research-bot.md
`;

const RESEARCH_YAML = `
name: research
description: Research and discovery
default: false

phases:
  - name: research
    worker: research-bot
    gates:
      - name: topic-defined
        label: Research topic and scope defined
      - name: findings-complete
        label: Findings document complete
        verify: file-exists findings.md

  - name: approve
    human-gate: true
    gates:
      - name: owner-sign-off
        label: Owner sign-off

  - name: archive
    terminal: true
    auto-archive: true
    gates:
      - name: deliverable-complete
        label: Final deliverable produced

features:
  discussion-log: true
  defect-cycle: false
  bug-intake: false
  cancellation: true
`;

// --- Template Loading & Parsing ---

describe("loadTemplateFromYaml", () => {
  it("parses a valid SDLC template", () => {
    const template = loadTemplateFromYaml(SDLC_YAML);
    expect(template.name).toBe("sdlc");
    expect(template.description).toBe("Software development lifecycle");
    expect(template.default).toBe(true);
    expect(template.phases.length).toBe(5);
  });

  it("parses phase properties", () => {
    const template = loadTemplateFromYaml(SDLC_YAML);
    const design = template.phases[0];
    expect(design.name).toBe("design");
    expect(design.worker).toBe("research-bot");
    expect(design.entryPoint).toBe(true); // first phase is always entry
    expect(design.terminal).toBe(false);
    expect(design.autoArchive).toBe(false);
    expect(design.humanGate).toBe(false);
  });

  it("parses gates", () => {
    const template = loadTemplateFromYaml(SDLC_YAML);
    const design = template.phases[0];
    expect(design.gates.length).toBe(3);
    expect(design.gates[0].name).toBe("design-doc-complete");
    expect(design.gates[0].label).toBe("Design doc complete");
    expect(design.gates[0].verify).toBe("file-exists design.md");
    expect(design.gates[0].artifacts).toEqual(["design.md"]);
  });

  it("parses gate variants", () => {
    const template = loadTemplateFromYaml(SDLC_YAML);
    const implement = template.phases[2];
    expect(implement.gateVariants).toBeDefined();
    expect(implement.gateVariants!.by).toBe("project-type");
    const cliGates = implement.gateVariants!["cli"] as any[];
    expect(cliGates.length).toBe(1);
    expect(cliGates[0].label).toBe("CLI starts and shows help");
  });

  it("parses human-gate flag", () => {
    const template = loadTemplateFromYaml(SDLC_YAML);
    const review = template.phases[1];
    expect(review.humanGate).toBe(true);
  });

  it("parses entry-point flag", () => {
    const template = loadTemplateFromYaml(SDLC_YAML);
    const implement = template.phases[2];
    expect(implement.entryPoint).toBe(true);
  });

  it("parses skip-if expression", () => {
    const template = loadTemplateFromYaml(SDLC_YAML);
    const test = template.phases[3];
    expect(test.skipIf).toBe("project-type == docs");
  });

  it("parses terminal and auto-archive", () => {
    const template = loadTemplateFromYaml(RESEARCH_YAML);
    const archive = template.phases[2];
    expect(archive.terminal).toBe(true);
    expect(archive.autoArchive).toBe(true);
  });

  it("parses features", () => {
    const template = loadTemplateFromYaml(SDLC_YAML);
    expect(template.features.discussionLog).toBe(true);
    expect(template.features.defectCycle).toBe(true);
    expect(template.features.bugIntake).toBe(true);
    expect(template.features.cancellation).toBe(true);
  });

  it("parses research template features", () => {
    const template = loadTemplateFromYaml(RESEARCH_YAML);
    expect(template.features.defectCycle).toBe(false);
    expect(template.features.bugIntake).toBe(false);
  });

  it("parses workers", () => {
    const template = loadTemplateFromYaml(SDLC_YAML);
    expect(template.workers["research-bot"]).toBeDefined();
    expect(template.workers["research-bot"].prompt).toBe("workers/research-bot.md");
  });

  it("throws on invalid YAML", () => {
    expect(() => loadTemplateFromYaml("not: valid: yaml: [")).toThrow();
  });

  it("throws on non-object YAML", () => {
    expect(() => loadTemplateFromYaml("just a string")).toThrow("Invalid YAML");
  });
});

// --- Validation ---

describe("validateTemplate", () => {
  it("validates a correct SDLC template", () => {
    const template = loadTemplateFromYaml(SDLC_YAML);
    const result = validateTemplate(template);
    expect(result.valid).toBe(true);
    expect(result.phaseCount).toBe(5);
    expect(result.gateCount).toBeGreaterThan(0);
  });

  it("rejects template with missing name", () => {
    const template = loadTemplateFromYaml(SDLC_YAML);
    template.name = "";
    const result = validateTemplate(template);
    expect(result.valid).toBe(false);
    expect(result.errors.some((e) => e.message.includes("name"))).toBe(true);
  });

  it("rejects template with no phases", () => {
    const template = loadTemplateFromYaml(SDLC_YAML);
    template.phases = [];
    const result = validateTemplate(template);
    expect(result.valid).toBe(false);
    expect(result.errors.some((e) => e.message.includes("at least one phase"))).toBe(true);
  });

  it("rejects duplicate phase names", () => {
    const template = loadTemplateFromYaml(SDLC_YAML);
    template.phases[1].name = "design"; // duplicate
    const result = validateTemplate(template);
    expect(result.valid).toBe(false);
    expect(result.errors.some((e) => e.message.includes("duplicate phase"))).toBe(true);
  });

  it("rejects phase with no gates", () => {
    const template = loadTemplateFromYaml(SDLC_YAML);
    template.phases[0].gates = [];
    const result = validateTemplate(template);
    expect(result.valid).toBe(false);
    expect(result.errors.some((e) => e.message.includes("at least one gate"))).toBe(true);
  });

  it("rejects duplicate gate names within phase", () => {
    const template = loadTemplateFromYaml(SDLC_YAML);
    template.phases[0].gates[1].name = "design-doc-complete"; // duplicate
    const result = validateTemplate(template);
    expect(result.valid).toBe(false);
    expect(result.errors.some((e) => e.message.includes("duplicate gate name"))).toBe(true);
  });

  it("rejects gate with missing label", () => {
    const template = loadTemplateFromYaml(SDLC_YAML);
    template.phases[0].gates[0].label = "";
    const result = validateTemplate(template);
    expect(result.valid).toBe(false);
    expect(result.errors.some((e) => e.message.includes("missing required field: label"))).toBe(true);
  });

  it("rejects unknown verify type", () => {
    const template = loadTemplateFromYaml(SDLC_YAML);
    template.phases[0].gates[0].verify = "unknown-type foo";
    const result = validateTemplate(template);
    expect(result.valid).toBe(false);
    expect(result.errors.some((e) => e.message.includes("unknown verify type"))).toBe(true);
  });

  it("accepts valid verify types", () => {
    const template = loadTemplateFromYaml(SDLC_YAML);
    // file-exists is already used; let's verify command and manual work
    template.phases[0].gates[1].verify = "command \"npm test\"";
    template.phases[0].gates[2].verify = "manual";
    const result = validateTemplate(template);
    expect(result.valid).toBe(true);
  });

  it("rejects invalid skip-if expression", () => {
    const template = loadTemplateFromYaml(SDLC_YAML);
    template.phases[3].skipIf = "invalid expression syntax here";
    const result = validateTemplate(template);
    expect(result.valid).toBe(false);
    expect(result.errors.some((e) => e.message.includes("invalid skip-if"))).toBe(true);
  });

  it("warns about missing worker prompt files", () => {
    const template = loadTemplateFromYaml(SDLC_YAML);
    const result = validateTemplate(template);
    expect(result.warnings.some((w) => w.message.includes("worker prompt file not found"))).toBe(true);
  });
});

describe("validateTemplateFile", () => {
  it("catches YAML parse errors", () => {
    const tmpFile = join(tmpdir(), "bad-template.yaml");
    writeFileSync(tmpFile, "invalid: yaml: [unclosed", "utf-8");
    const result = validateTemplateFile(tmpFile);
    expect(result.valid).toBe(false);
    expect(result.errors[0].message).toContain("YAML parse error");
    rmSync(tmpFile);
  });
});

// --- Phase Engine ---

describe("nextPhaseFromTemplate", () => {
  const template = loadTemplateFromYaml(SDLC_YAML);

  it("advances through phases", () => {
    expect(nextPhaseFromTemplate("design", template)).toBe("review");
    expect(nextPhaseFromTemplate("review", template)).toBe("implement");
    expect(nextPhaseFromTemplate("implement", template)).toBe("test");
    expect(nextPhaseFromTemplate("test", template)).toBe("final-review");
  });

  it("returns null at terminal phase", () => {
    expect(nextPhaseFromTemplate("final-review", template)).toBeNull();
  });

  it("returns null for unknown phase", () => {
    expect(nextPhaseFromTemplate("nonexistent", template)).toBeNull();
  });
});

describe("prevPhaseFromTemplate", () => {
  const template = loadTemplateFromYaml(SDLC_YAML);

  it("goes back through phases", () => {
    expect(prevPhaseFromTemplate("final-review", template)).toBe("test");
    expect(prevPhaseFromTemplate("test", template)).toBe("implement");
    expect(prevPhaseFromTemplate("implement", template)).toBe("review");
    expect(prevPhaseFromTemplate("review", template)).toBe("design");
  });

  it("returns null at first phase", () => {
    expect(prevPhaseFromTemplate("design", template)).toBeNull();
  });
});

describe("isEntryPoint", () => {
  const template = loadTemplateFromYaml(SDLC_YAML);

  it("identifies entry points", () => {
    expect(isEntryPoint("design", template)).toBe(true);
    expect(isEntryPoint("implement", template)).toBe(true);
  });

  it("identifies non-entry-points", () => {
    expect(isEntryPoint("review", template)).toBe(false);
    expect(isEntryPoint("test", template)).toBe(false);
    expect(isEntryPoint("final-review", template)).toBe(false);
  });
});

describe("isTerminal", () => {
  const template = loadTemplateFromYaml(SDLC_YAML);

  it("identifies terminal phases", () => {
    expect(isTerminal("final-review", template)).toBe(true);
  });

  it("identifies non-terminal phases", () => {
    expect(isTerminal("design", template)).toBe(false);
    expect(isTerminal("implement", template)).toBe(false);
  });
});

describe("isHumanGate", () => {
  const template = loadTemplateFromYaml(SDLC_YAML);

  it("identifies human-gate phases", () => {
    expect(isHumanGate("review", template)).toBe(true);
  });

  it("identifies non-human-gate phases", () => {
    expect(isHumanGate("design", template)).toBe(false);
    expect(isHumanGate("implement", template)).toBe(false);
  });
});

describe("shouldAutoArchive", () => {
  const template = loadTemplateFromYaml(RESEARCH_YAML);

  it("identifies auto-archive phases", () => {
    expect(shouldAutoArchive("archive", template)).toBe(true);
  });

  it("identifies non-auto-archive phases", () => {
    expect(shouldAutoArchive("research", template)).toBe(false);
  });
});

// --- Skip-If Evaluation ---

describe("evaluateSkipIf", () => {
  it("evaluates == expression correctly", () => {
    expect(evaluateSkipIf("project-type == docs", { "project-type": "docs" })).toBe(true);
    expect(evaluateSkipIf("project-type == docs", { "project-type": "cli" })).toBe(false);
  });

  it("evaluates != expression correctly", () => {
    expect(evaluateSkipIf("project-type != docs", { "project-type": "cli" })).toBe(true);
    expect(evaluateSkipIf("project-type != docs", { "project-type": "docs" })).toBe(false);
  });

  it("returns false for empty expression", () => {
    expect(evaluateSkipIf("", {})).toBe(false);
  });

  it("returns false for invalid expression", () => {
    expect(evaluateSkipIf("bad syntax here", {})).toBe(false);
  });

  it("treats missing field as empty string", () => {
    expect(evaluateSkipIf("field == value", {})).toBe(false);
    expect(evaluateSkipIf("field != value", {})).toBe(true);
  });
});

// --- Gate Resolution ---

describe("resolveGates", () => {
  const template = loadTemplateFromYaml(SDLC_YAML);

  it("returns base gates when no project type", () => {
    const implement = template.phases[2];
    const gates = resolveGates(implement);
    expect(gates.length).toBe(2);
    expect(gates[0].label).toBe("Builds clean");
  });

  it("includes variant gates for matching project type", () => {
    const implement = template.phases[2];
    const gates = resolveGates(implement, "cli");
    expect(gates.length).toBe(3);
    expect(gates[2].label).toBe("CLI starts and shows help");
  });

  it("returns only base gates for non-matching type", () => {
    const implement = template.phases[2];
    const gates = resolveGates(implement, "service");
    expect(gates.length).toBe(2); // no service variants in implement
  });

  it("resolves test phase variants for cli", () => {
    const test = template.phases[3];
    const gates = resolveGates(test, "cli");
    expect(gates.length).toBe(2); // base + cli variant
    expect(gates[1].label).toBe("Smoke test passed");
  });

  it("resolves test phase variants for library", () => {
    const test = template.phases[3];
    const gates = resolveGates(test, "library");
    expect(gates.length).toBe(2); // base + library variant
    expect(gates[1].label).toBe("npm pack succeeds");
  });
});

describe("resolveAllPhaseGates", () => {
  const template = loadTemplateFromYaml(SDLC_YAML);

  it("resolves gates for all phases", () => {
    const allGates = resolveAllPhaseGates(template, "cli");
    expect(allGates.size).toBe(5);
    expect(allGates.get("design")!.length).toBe(3);
    expect(allGates.get("implement")!.length).toBe(3); // 2 base + 1 cli
  });
});

// --- Verify Gate Checks ---

describe("checkVerifyGate", () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = join(tmpdir(), `flow-test-${Date.now()}`);
    mkdirSync(tmpDir, { recursive: true });
  });

  afterEach(() => {
    rmSync(tmpDir, { recursive: true });
  });

  it("checks file-exists (file present)", () => {
    writeFileSync(join(tmpDir, "design.md"), "# Design", "utf-8");
    expect(checkVerifyGate("file-exists design.md", tmpDir)).toBe(true);
  });

  it("checks file-exists (file missing)", () => {
    expect(checkVerifyGate("file-exists design.md", tmpDir)).toBe(false);
  });

  it("checks command (success)", () => {
    expect(checkVerifyGate('command "true"', tmpDir)).toBe(true);
  });

  it("checks command (failure)", () => {
    expect(checkVerifyGate('command "false"', tmpDir)).toBe(false);
  });

  it("returns false for manual verify", () => {
    expect(checkVerifyGate("manual", tmpDir)).toBe(false);
  });
});

// --- Template Init/Fork ---

describe("generateInitTemplate", () => {
  it("generates a valid template scaffold", () => {
    const content = generateInitTemplate("my-flow");
    const template = loadTemplateFromYaml(content);
    expect(template.name).toBe("my-flow");
    expect(template.phases.length).toBe(3);
    const result = validateTemplate(template);
    expect(result.valid).toBe(true);
  });
});

// --- Template-driven Project Generation ---

describe("generateProjectMdFromTemplate", () => {
  const template = loadTemplateFromYaml(SDLC_YAML);

  it("generates project with correct frontmatter", () => {
    const md = generateProjectMdFromTemplate("test-proj", "A test", "cli", 3, "2026-03-07", template);
    const fm = parseFrontmatter(md);
    expect(fm.name).toBe("test-proj");
    expect(fm.flow).toBe("sdlc");
    expect(fm["flow-version"]).toBe("1");
    expect(fm.phase).toBe("design");
  });

  it("generates all gate sections", () => {
    const md = generateProjectMdFromTemplate("test-proj", "A test", "cli", 3, "2026-03-07", template);
    const sections = parseGates(md);
    expect(sections.length).toBe(5);
    expect(sections[0].name).toBe("Design");
    expect(sections[4].name).toBe("Final Review");
  });

  it("includes variant gates for project type", () => {
    const md = generateProjectMdFromTemplate("test-proj", "A test", "cli", 3, "2026-03-07", template);
    const sections = parseGates(md);
    const implement = sections[2];
    expect(implement.gates.some((g) => g.label === "CLI starts and shows help")).toBe(true);
  });

  it("supports start-at phase", () => {
    const md = generateProjectMdFromTemplate("test-proj", "A test", "cli", 3, "2026-03-07", template, "implement");
    const fm = parseFrontmatter(md);
    expect(fm.phase).toBe("implement");
    // Skipped phases should have N/A markers
    expect(md).toContain("N/A");
  });

  it("sets flow-version in frontmatter", () => {
    const md = generateProjectMdFromTemplate("test-proj", "A test", "cli", 3, "2026-03-07", template, undefined, 2);
    const fm = parseFrontmatter(md);
    expect(fm["flow-version"]).toBe("2");
  });
});

describe("research flow template", () => {
  const template = loadTemplateFromYaml(RESEARCH_YAML);

  it("has 3 phases", () => {
    expect(template.phases.length).toBe(3);
    expect(template.phases.map((p) => p.name)).toEqual(["research", "approve", "archive"]);
  });

  it("research is first phase and entry point", () => {
    expect(template.phases[0].entryPoint).toBe(true);
  });

  it("approve has human-gate", () => {
    expect(isHumanGate("approve", template)).toBe(true);
  });

  it("archive is terminal with auto-archive", () => {
    expect(isTerminal("archive", template)).toBe(true);
    expect(shouldAutoArchive("archive", template)).toBe(true);
  });

  it("generates a research project", () => {
    const md = generateProjectMdFromTemplate("my-research", "Explore something", "library", 3, "2026-03-07", template);
    const fm = parseFrontmatter(md);
    expect(fm.flow).toBe("research");
    expect(fm.phase).toBe("research");
    const sections = parseGates(md);
    expect(sections.length).toBe(3);
    expect(sections[0].name).toBe("Research");
    expect(sections[1].name).toBe("Approve");
    expect(sections[2].name).toBe("Archive");
  });

  it("disables defect cycle and bug intake", () => {
    expect(template.features.defectCycle).toBe(false);
    expect(template.features.bugIntake).toBe(false);
  });
});

// --- Installed Templates ---

describe("listInstalledTemplates", () => {
  it("finds installed YAML templates", () => {
    const templates = listInstalledTemplates();
    expect(templates.length).toBeGreaterThanOrEqual(2);
    const names = templates.map((t) => t.name);
    expect(names).toContain("sdlc");
    expect(names).toContain("research");
  });
});

describe("loadInstalledTemplate", () => {
  it("loads sdlc template by name", () => {
    const template = loadInstalledTemplate("sdlc");
    expect(template).not.toBeNull();
    expect(template!.name).toBe("sdlc");
    expect(template!.default).toBe(true);
  });

  it("loads research template by name", () => {
    const template = loadInstalledTemplate("research");
    expect(template).not.toBeNull();
    expect(template!.name).toBe("research");
  });

  it("returns null for unknown template", () => {
    const template = loadInstalledTemplate("nonexistent");
    expect(template).toBeNull();
  });
});

// --- CLI flow subcommands ---

describe("CLI flow commands", () => {
  const { execSync } = require("node:child_process");

  function run(cmd: string): string {
    return execSync(cmd, { encoding: "utf-8", timeout: 10000 }).trim();
  }

  it("flow list shows installed templates", () => {
    const output = run("pipeline flow list");
    expect(output).toContain("sdlc");
    expect(output).toContain("research");
    expect(output).toContain("(default)");
  });

  it("flow show displays template details", () => {
    const output = run("pipeline flow show sdlc");
    expect(output).toContain("sdlc");
    expect(output).toContain("design");
    expect(output).toContain("review");
    expect(output).toContain("implement");
    expect(output).toContain("human-gate");
    expect(output).toContain("entry-point");
  });

  it("flow show fails for unknown template", () => {
    try {
      run("pipeline flow show nonexistent");
      expect.unreachable("Should have thrown");
    } catch (e: any) {
      expect(e.status).not.toBe(0);
    }
  });

  it("flow validate accepts valid template", () => {
    const output = run(`pipeline flow validate ~/mesh-vibe/data/vibe-flow-spec/sdlc.yaml`);
    expect(output).toContain("Valid");
    expect(output).toContain("phases");
  });

  it("flow validate rejects invalid template", () => {
    const tmpFile = join(tmpdir(), "invalid-template.yaml");
    writeFileSync(tmpFile, "name: bad\nphases: []", "utf-8");
    try {
      run(`pipeline flow validate ${tmpFile}`);
      expect.unreachable("Should have thrown");
    } catch (e: any) {
      expect(e.status).not.toBe(0);
    }
    rmSync(tmpFile);
  });

  it("flow init creates a scaffold file", () => {
    const tmpFile = join(tmpdir(), "test-scaffold.yaml");
    if (existsSync(tmpFile)) rmSync(tmpFile);
    const output = run(`cd ${tmpdir()} && pipeline flow init test-scaffold`);
    expect(output).toContain("Created template scaffold");
    expect(existsSync(tmpFile)).toBe(true);
    // Validate the scaffold
    const validateOutput = run(`pipeline flow validate ${tmpFile}`);
    expect(validateOutput).toContain("Valid");
    rmSync(tmpFile);
  });
});
