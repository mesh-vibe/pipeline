import type { FlowTemplate, FlowGate } from "./flow-types.js";
import { resolveGates } from "./flow.js";
import { timestamp } from "./project.js";

function titleCase(name: string): string {
  return name
    .split("-")
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
    .join(" ");
}

function phaseToSectionName(phase: string): string {
  return phase
    .split("-")
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
    .join(" ");
}

function renderGates(gates: FlowGate[], checked: boolean = false): string {
  return gates
    .map((g) => `- [${checked ? "x" : " "}] ${g.label}`)
    .join("\n");
}

// --- Legacy hardcoded gates (backward compat when no template available) ---

function getLegacyTestGates(type: string): string {
  switch (type) {
    case "cli":
      return `### Test
- [ ] CLI starts and shows help
- [ ] Smoke test passed (core commands)
- [ ] Integration test passed
- [ ] All acceptance criteria verified`;
    case "service":
      return `### Test
- [ ] Service starts cleanly on expected port
- [ ] Smoke test passed (health endpoint)
- [ ] Integration test passed
- [ ] UI verified (if applicable)`;
    case "library":
      return `### Test
- [ ] Unit tests pass
- [ ] Integration tests pass
- [ ] npm pack succeeds`;
    case "heartbeat-task":
      return `### Test
- [ ] Task runs without error
- [ ] Output matches expected format
- [ ] Timeout is respected`;
    default:
      return `### Test
- [ ] Tests pass`;
  }
}

// --- Template-driven project generation ---

export function generateProjectMdFromTemplate(
  name: string,
  description: string,
  type: string,
  priority: number,
  date: string,
  template: FlowTemplate,
  startAtPhase?: string,
  flowVersion: number = 1,
): string {
  const startIdx = startAtPhase
    ? template.phases.findIndex((p) => p.name === startAtPhase)
    : 0;
  const startPhase = startIdx >= 0 ? template.phases[startIdx].name : template.phases[0].name;

  let frontmatter = `---
name: ${name}
description: ${description}
flow: ${template.name}
flow-version: ${flowVersion}
project-type: ${type}
phase: ${startPhase}
priority: ${priority}
created: ${date}
updated: ${timestamp()}
approved-at:
stuck-threshold-minutes: 120
cancelled: false
cancelled-reason:
cancelled-at:
cancelled-from:
---`;

  let gatesSections = "";
  for (let i = 0; i < template.phases.length; i++) {
    const phase = template.phases[i];
    const gates = resolveGates(phase, type);
    const sectionName = phaseToSectionName(phase.name);

    if (startAtPhase && i < startIdx) {
      // Mark skipped phases as N/A
      gatesSections += `\n### ${sectionName}\n`;
      gatesSections += gates.map((g) => `- [x] ${g.label} (N/A — skipped)`).join("\n");
      gatesSections += "\n";
    } else {
      gatesSections += `\n### ${sectionName}\n`;
      gatesSections += renderGates(gates);
      gatesSections += "\n";
    }
  }

  const historyEntry = startAtPhase
    ? `- ${date} — Entered ${startPhase} phase (start-at)`
    : `- ${date} — Entered ${startPhase} phase`;

  return `${frontmatter}

# ${titleCase(name)}

${description}

## Gates
${gatesSections}
## Phase History

${historyEntry}
`;
}

// --- Legacy project generation (no template) ---

export function generateProjectMd(
  name: string,
  description: string,
  type: string,
  priority: number,
  date: string,
  flow: string = "sdlc",
): string {
  return `---
name: ${name}
description: ${description}
flow: ${flow}
flow-version: 1
project-type: ${type}
phase: design
priority: ${priority}
created: ${date}
updated: ${timestamp()}
approved-at:
stuck-threshold-minutes: 120
cancelled: false
cancelled-reason:
cancelled-at:
cancelled-from:
---

# ${titleCase(name)}

${description}

## Gates

### Design
- [ ] Design doc complete
- [ ] Open questions resolved
- [ ] Approach decided

### Review
- [ ] use-cases.md produced (happy path, edge cases, error scenarios)
- [ ] cli-spec.md produced (commands, flags, output, examples)
- [ ] acceptance-criteria.md produced (testable Given/When/Then statements)
- [ ] No ambiguity remaining in design
- [ ] Test coverage target specified
- [ ] Owner sign-off

### Implement
- [ ] Builds clean
- [ ] Tests passing
- [ ] Coverage target met
- [ ] Standards-bot passes (~/IdeaProjects/mesh-vibe/mesh-vibe/README.md)

${getLegacyTestGates(type)}

### Final Review
- [ ] All artifacts present and consistent
- [ ] Acceptance criteria mapped to test results
- [ ] No orphaned files or TODOs
- [ ] final-review.md written

## Phase History

- ${date} — Entered design phase
`;
}

export function generateBugfixProjectMd(
  name: string,
  description: string,
  type: string,
  priority: number,
  date: string,
  flow: string = "sdlc",
): string {
  return `---
name: ${name}
description: ${description}
flow: ${flow}
flow-version: 1
project-type: ${type}
phase: implement
priority: ${priority}
created: ${date}
updated: ${timestamp()}
approved-at:
stuck-threshold-minutes: 120
cancelled: false
cancelled-reason:
cancelled-at:
cancelled-from:
---

# ${titleCase(name)}

${description}

## Gates

### Implement
- [ ] Builds clean
- [ ] Tests passing
- [ ] Coverage target met
- [ ] Standards-bot passes (~/IdeaProjects/mesh-vibe/mesh-vibe/README.md)

${getLegacyTestGates(type)}

### Final Review
- [ ] All artifacts present and consistent
- [ ] Acceptance criteria mapped to test results
- [ ] No orphaned files or TODOs
- [ ] final-review.md written

## Phase History

- ${date} — Created as bugfix project (implement phase)
`;
}

export function generateDefectMd(
  description: string,
  severity: string,
  date: string,
): string {
  return `---
description: ${description}
severity: ${severity}
status: open
filed: ${date}
fixed-at:
verified-at:
---

# Defect

${description}

## Repro Steps

_(fill in)_

## Expected Behavior

_(fill in)_

## Actual Behavior

_(fill in)_
`;
}
