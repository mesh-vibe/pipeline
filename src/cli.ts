#!/usr/bin/env node

import { Command } from "commander";
import {
  existsSync,
  mkdirSync,
  writeFileSync,
  readdirSync,
  renameSync,
  appendFileSync,
  cpSync,
} from "node:fs";
import { execSync } from "node:child_process";
import { join, basename } from "node:path";

import type { Phase, ProjectType } from "./types.js";
import { VALID_TYPES, PHASES } from "./types.js";
import {
  getPipelineDir,
  getActiveDir,
  getArchiveDir,
  getSpecDir,
  getSpecFlowDir,
  getProjectDir,
  getArchivedProjectDir,
  getProjectFile,
  getPromptQueueProjectsDir,
  getFlowsDir,
  getFlowActiveDir,
  getFlowArchiveDir,
  getFlowProjectDir,
  getFlowArchivedProjectDir,
  findProjectDir,
  findArchivedProjectDir,
} from "./paths.js";
import {
  readProject,
  readArchivedProject,
  listActiveProjects,
  listArchivedProjects,
  parseGates,
  getPhaseGates,
  countGates,
  allGatesMet,
  updateProject,
  checkGate,
  answerGate,
  uncheckPhaseGates,
  appendPhaseHistory,
  nextPhase,
  prevPhase,
  listDefects,
  checkArtifacts,
  moveToArchive,
  moveFromArchive,
  today,
  timestamp,
  slugify,
  NAME_REGEX,
  timeAgo,
  isNeedsInteractive,
  clearNeedsInteractive,
} from "./project.js";
import { generateProjectMd, generateProjectMdFromTemplate, generateBugfixProjectMd, generateDefectMd } from "./template.js";
import { installSkill } from "./templates/skill.md.js";
import { installHeartbeatTask } from "./templates/heartbeat-task.md.js";
import { SDLC_YAML } from "./templates/sdlc.yaml.js";
import { RESEARCH_YAML } from "./templates/research.yaml.js";
import {
  listInstalledTemplates,
  loadInstalledTemplate,
  validateTemplateFile,
  installTemplate,
  uninstallTemplate,
  generateInitTemplate,
  forkTemplate,
  migrateProject,
  resolveGates,
  isEntryPoint,
  isHumanGate,
  isTerminal,
  nextPhaseFromTemplate,
  getFlowGateByLabel,
} from "./flow.js";
import { runSupervise } from "./supervise-runner.js";
import { postMemo } from "./memo.js";

function localTimestamp(): string {
  const now = new Date();
  const y = now.getFullYear();
  const m = String(now.getMonth() + 1).padStart(2, "0");
  const d = String(now.getDate()).padStart(2, "0");
  const h = String(now.getHours()).padStart(2, "0");
  const min = String(now.getMinutes()).padStart(2, "0");
  return `${y}-${m}-${d} ${h}:${min}`;
}

const SPEC_README = `# vibe-flow-spec

Flow specifications for the vibe-flow pipeline. Each subdirectory is a complete
flow definition that projects can reference via \`flow: <name>\` in their frontmatter.

## Installed Flows

Each directory here is a flow spec. List them with:

\`\`\`
pipeline flow list
\`\`\`

## Creating a New Flow Spec

A flow spec is a directory containing documentation that defines:

1. **Phases** — the ordered stages a project moves through
2. **Gates** — checkboxes that must be satisfied before advancing
3. **Artifacts** — files produced at each phase

### Required Structure

\`\`\`
my-flow-v1.0/
  README.md              # Overview, when to use this flow
  pipeline-architecture.md   # Phase definitions and gate specs
  pipeline-cli-spec.md       # CLI behavior for this flow
  pipeline-use-cases.md      # Usage scenarios
  pipeline-acceptance-criteria.md  # Testable criteria
\`\`\`

### Gate Format

Gates are defined as markdown checkboxes grouped under phase headings:

\`\`\`markdown
### Design
- [ ] Design doc complete
- [ ] Open questions resolved

### Implement
- [ ] Builds clean
- [ ] Tests passing
\`\`\`

### Adding a Flow

Copy your spec directory into this folder, or use:

\`\`\`
pipeline flow add <path-to-spec-dir>
\`\`\`

### Referencing a Flow

When creating a project, specify the flow:

\`\`\`
pipeline create my-project "description" --flow SDLC-Point-Release-v1.0
\`\`\`

The flow name is stored in the project's frontmatter and used by the pipeline
to determine which gates and phases apply.
`;

const VIBE_FLOW_README = `# vibe-flow

Runtime data for the vibe-flow pipeline. Managed by the \`pipeline\` CLI.

## Structure

\`\`\`
vibe-flow/
  flows/
    point-release/
      active/        # SDLC projects in progress
      archive/       # Completed or cancelled SDLC projects
    research/
      active/        # Research projects in progress
      archive/       # Completed or cancelled research projects
  README.md          # This file
\`\`\`

Each project is a directory under its flow's \`active/\` dir containing \`project.md\` (frontmatter +
gates) and artifacts produced during its lifecycle (design docs, test results, etc.).

## Flow Specs

Flow specifications live in the \`specs/\` directory. See
\`specs/README.md\` for how to create and install new flows.

## Commands

\`\`\`
pipeline status          # overview of all active projects
pipeline create <name>   # create a new project
pipeline list            # compact project list
pipeline flow list       # list installed flow specs
\`\`\`

Run \`pipeline --help\` for the full command list.
`;

const program = new Command();

program
  .name("pipeline")
  .description("Autonomous SDLC pipeline for mesh-vibe projects")
  .version("0.1.0");

// --- init ---

program
  .command("init")
  .description("Bootstrap pipeline directories and templates")
  .option("--migrate", "Move existing design docs and projects into pipeline structure")
  .option("--dry-run", "Show what --migrate would do without doing it")
  .action((opts) => {
    const pipelineDir = getPipelineDir();
    const flowsDir = getFlowsDir();

    // Create flows directory structure
    if (!existsSync(flowsDir)) {
      mkdirSync(flowsDir, { recursive: true });
      console.log(`Created ${flowsDir}`);
    }

    // Create default flow directories
    const defaultFlowActive = getFlowActiveDir("point-release");
    const defaultFlowArchive = getFlowArchiveDir("point-release");
    if (!existsSync(defaultFlowActive)) {
      mkdirSync(defaultFlowActive, { recursive: true });
      console.log(`Created ${defaultFlowActive}`);
    }
    if (!existsSync(defaultFlowArchive)) {
      mkdirSync(defaultFlowArchive, { recursive: true });
      console.log(`Created ${defaultFlowArchive}`);
    }

    const researchFlowActive = getFlowActiveDir("research");
    const researchFlowArchive = getFlowArchiveDir("research");
    if (!existsSync(researchFlowActive)) {
      mkdirSync(researchFlowActive, { recursive: true });
      console.log(`Created ${researchFlowActive}`);
    }
    if (!existsSync(researchFlowArchive)) {
      mkdirSync(researchFlowArchive, { recursive: true });
      console.log(`Created ${researchFlowArchive}`);
    }

    const specDir = getSpecDir();
    if (!existsSync(specDir)) {
      mkdirSync(specDir, { recursive: true });
      console.log(`Created ${specDir}`);
    }

    // Install YAML flow templates
    const sdlcYamlPath = join(specDir, "point-release.yaml");
    if (!existsSync(sdlcYamlPath)) {
      writeFileSync(sdlcYamlPath, SDLC_YAML, "utf-8");
      console.log("Installed flow template: point-release.yaml");
    }
    const researchYamlPath = join(specDir, "research.yaml");
    if (!existsSync(researchYamlPath)) {
      writeFileSync(researchYamlPath, RESEARCH_YAML, "utf-8");
      console.log("Installed flow template: research.yaml");
    }

    // Write spec README if missing
    const specReadme = join(specDir, "README.md");
    if (!existsSync(specReadme)) {
      writeFileSync(specReadme, SPEC_README, "utf-8");
      console.log(`Created ${specReadme}`);
    }

    // Write vibe-flow README if missing
    const vfReadme = join(pipelineDir, "README.md");
    if (!existsSync(vfReadme)) {
      writeFileSync(vfReadme, VIBE_FLOW_README, "utf-8");
      console.log(`Created ${vfReadme}`);
    }

    // Register with registry
    try {
      execSync("registry register pipeline 2>/dev/null", { stdio: "pipe" });
      console.log("Registered pipeline with registry.");
    } catch {
      // registry may not be available
    }

    // Install skill
    installSkill();
    console.log("Installed Claude skill at ~/.claude/skills/pipeline/SKILL.md");

    // Install heartbeat task
    if (installHeartbeatTask()) {
      console.log("Installed heartbeat task at ~/mesh-vibe/heartbeat/vibe-flow.md");
    }

    if (!opts.migrate) {
      console.log("Pipeline initialized.");
    }
  });

// --- create ---

program
  .command("create")
  .description("Create a new project in design phase")
  .argument("<name>", "kebab-case project name")
  .argument("<description>", "One-line project description")
  .option("--type <type>", "Project type: service, cli, library, heartbeat-task", "cli")
  .option("--priority <n>", "Priority 1-5, 1=highest", "3")
  .option("--flow <flow>", "Flow template to use")
  .option("--start-at <phase>", "Start at a specific entry point phase")
  .option("--blocked-by <projects>", "Comma-separated list of projects that must complete first")
  .action((name: string, description: string, opts) => {
    if (!NAME_REGEX.test(name)) {
      console.error(`Invalid project name '${name}'. Must be kebab-case.`);
      process.exit(2);
    }

    const type = opts.type as ProjectType;
    if (!VALID_TYPES.includes(type)) {
      console.error(
        `Invalid type '${type}'. Must be: ${VALID_TYPES.join(", ")}`,
      );
      process.exit(2);
    }

    const priority = parseInt(opts.priority, 10);
    if (isNaN(priority) || priority < 1 || priority > 5) {
      console.error(`Invalid priority '${opts.priority}'. Must be 1-5.`);
      process.exit(2);
    }

    // Check for duplicates across all flows
    if (findProjectDir(name)) {
      console.error(`Project '${name}' already exists in active pipeline`);
      process.exit(1);
    }

    if (findArchivedProjectDir(name)) {
      console.error(
        `Project '${name}' exists in archive. Use --reactivate to restore it.`,
      );
      process.exit(1);
    }

    // Determine flow: explicit flag > default template
    let flowName = opts.flow;
    if (!flowName) {
      const defaultTemplate = listInstalledTemplates().find((t) => t.default);
      flowName = defaultTemplate ? defaultTemplate.name : "point-release";
    }

    // Try to load a YAML flow template
    const template = loadInstalledTemplate(flowName);

    if (opts.startAt && template) {
      if (!isEntryPoint(opts.startAt, template)) {
        const entryPoints = template.phases
          .filter((p) => p.entryPoint)
          .map((p) => p.name);
        console.error(
          `Phase '${opts.startAt}' is not an entry point. Valid entry points: ${entryPoints.join(", ")}`,
        );
        process.exit(2);
      }
    } else if (opts.startAt && !template) {
      console.error(`--start-at requires a YAML flow template. Flow '${flowName}' has no template.`);
      process.exit(2);
    }

    // Use flow-based directory structure
    const flowSlug = flowName.toLowerCase().replace(/\./g, "-");
    const projectDir = getFlowProjectDir(flowSlug, name);
    mkdirSync(projectDir, { recursive: true });

    let projectMd: string;
    let startPhase: string;
    if (template) {
      const blockedBy = opts.blockedBy ? opts.blockedBy.split(",").map((s: string) => s.trim()).filter(Boolean) : undefined;
      projectMd = generateProjectMdFromTemplate(
        name, description, type, priority, today(), template, opts.startAt, 1, blockedBy,
      );
      startPhase = opts.startAt || template.phases[0].name;
    } else {
      projectMd = generateProjectMd(name, description, type, priority, today(), flowName);
      startPhase = "design";
    }
    writeFileSync(join(projectDir, "project.md"), projectMd, "utf-8");

    writeFileSync(
      join(projectDir, "discussion.md"),
      "# Discussion Log\n",
      "utf-8",
    );

    console.log(`Created project: ${name}`);
    console.log(`  Flow: ${flowName}`);
    console.log(`  Type: ${type}`);
    console.log(`  Phase: ${startPhase}`);
    console.log(`  Priority: ${priority}`);
    console.log(`  Directory: ${projectDir}/`);

    try {
      const data = JSON.stringify({ project: name, flow: flowName, phase: startPhase, priority });
      execSync(
        `eventlog emit "pipeline.project.created" --source pipeline --data '${data}'`,
        { stdio: "pipe", timeout: 5000 },
      );
    } catch {
      // fire-and-forget
    }
  });

// --- status ---

program
  .command("status")
  .description("Show pipeline status (all or one project)")
  .argument("[name]", "Project name for detailed status")
  .option("--json", "Output in JSON format")
  .action((name: string | undefined, opts) => {
    if (name) {
      const proj = readProject(name);
      if (!proj) {
        console.error(`Project '${name}' not found in active pipeline`);
        process.exit(1);
      }

      if (opts.json) {
        const gateSections = parseGates(proj.rawContent);
        const defects = listDefects(getProjectDir(name));
        console.log(
          JSON.stringify(
            { status: "ok", data: { ...proj.frontmatter, gates: gateSections, defects } },
            null,
            2,
          ),
        );
        return;
      }

      const fm = proj.frontmatter;
      const updatedAgo = timeAgo(fm.updated);
      const stuckMs = fm["stuck-threshold-minutes"] * 60000;
      const hasTimezone = fm.updated.endsWith("Z") || /T\d{2}:\d{2}(:\d{2})?([+-]\d{2}:?\d{2})$/.test(fm.updated);
      const normalizedUpdated = hasTimezone ? fm.updated : fm.updated.replace(/ /, "T") + "Z";
      const timeSinceUpdate = Date.now() - new Date(normalizedUpdated).getTime();
      const isStuck = timeSinceUpdate > stuckMs;

      console.log(fm.name);
      console.log("=".repeat(fm.name.length));
      console.log(`Phase:       ${fm.phase}`);
      console.log(`Type:        ${fm["project-type"]}`);
      console.log(`Priority:    ${fm.priority}`);
      console.log(`Created:     ${fm.created}`);
      console.log(
        `Updated:     ${fm.updated}${updatedAgo ? ` (${updatedAgo})` : ""}`,
      );
      console.log(
        `Stuck:       ${isStuck ? "YES" : "no"} (threshold: ${fm["stuck-threshold-minutes"]}m)`,
      );

      if (isNeedsInteractive(fm)) {
        console.log();
        console.log(`\u26A0 NEEDS INTERACTIVE: ${fm["needs-interactive-reason"]}`);
        console.log(`  Run: pipeline unblock ${fm.name}`);
      }

      const gateSections = parseGates(proj.rawContent);
      for (const section of gateSections) {
        console.log(`\n${section.name} Gates:`);
        for (const gate of section.gates) {
          console.log(`  [${gate.checked ? "x" : " "}] ${gate.label}`);
        }
      }

      const defects = listDefects(getProjectDir(name));
      const open = defects.filter((d) => d.status === "open").length;
      const fixed = defects.filter((d) => d.status === "fixed").length;
      const verified = defects.filter((d) => d.status === "verified").length;
      console.log(
        `\nDefects: ${open} open, ${fixed} fixed, ${verified} verified`,
      );

      const historyMatch = proj.rawContent.match(
        /## Phase History\n([\s\S]*?)$/,
      );
      if (historyMatch) {
        console.log("\nPhase History:");
        const lines = historyMatch[1]
          .split("\n")
          .filter((l) => l.startsWith("- "));
        for (const line of lines) {
          console.log(`  ${line.slice(2)}`);
        }
      }

      const artifacts = checkArtifacts(getProjectDir(name));
      console.log("\nFiles:");
      for (const a of artifacts) {
        console.log(
          `  ${a.name.padEnd(26)} ${a.exists ? "\u2713" : "\u2014"}`,
        );
      }
    } else {
      const projects = listActiveProjects();

      if (opts.json) {
        const data = projects.map((p) => ({
          ...p.frontmatter,
          gates: countGates(p.rawContent, p.frontmatter.phase as string),
        }));
        console.log(JSON.stringify({ status: "ok", data }, null, 2));
        return;
      }

      console.log("Pipeline Status");
      console.log("\u2550".repeat(15));

      // Collect all phases: standard SDLC phases first, then any extras from other flows
      const allPhases = [...PHASES];
      for (const p of projects) {
        const ph = p.frontmatter.phase as string;
        if (ph && !allPhases.includes(ph)) allPhases.push(ph);
      }

      for (const phase of allPhases) {
        const inPhase = projects.filter((p) => p.frontmatter.phase === phase);
        if (inPhase.length === 0) continue;
        console.log(`\n${phase.toUpperCase()} (${inPhase.length})`);
        for (const proj of inPhase) {
          const { checked, total } = countGates(proj.rawContent, phase);
          const updated = timeAgo(proj.frontmatter.updated);
          console.log(
            `  ${proj.frontmatter.name.padEnd(25)} ${checked}/${total} gates   priority:${proj.frontmatter.priority}   updated ${updated}`,
          );
          const blockedBy = proj.frontmatter["blocked-by"];
          if (blockedBy && blockedBy.length > 0) {
            console.log(`    \u26D4 Blocked by: ${blockedBy.join(", ")}`);
          } else if (isNeedsInteractive(proj.frontmatter)) {
            console.log(`  \u26A0 Needs interactive: ${proj.frontmatter["needs-interactive-reason"]}`);
          } else if (phase === "review") {
            const reviewGates = getPhaseGates(proj.rawContent, "review");
            const signoffGate = reviewGates.find((g) =>
              g.label.includes("Owner sign-off"),
            );
            if (signoffGate && !signoffGate.checked) {
              const nonSignoff = reviewGates.filter(
                (g) => !g.label.includes("Owner sign-off"),
              );
              if (nonSignoff.every((g) => g.checked)) {
                console.log("    \u26A0 Awaiting owner sign-off");
              }
            }
          }
        }
      }

      const archived = listArchivedProjects();
      console.log(
        `\n${"─".repeat(15)}\n${projects.length} active projects | ${archived.length} archived`,
      );
    }
  });

// --- list ---

program
  .command("list")
  .description("List projects (compact)")
  .option("--archive", "Show archived projects instead of active")
  .option("--json", "Output in JSON format")
  .action((opts) => {
    if (opts.archive) {
      const projects = listArchivedProjects();

      if (opts.json) {
        console.log(
          JSON.stringify(
            { status: "ok", data: projects.map((p) => p.frontmatter) },
            null,
            2,
          ),
        );
        return;
      }

      if (projects.length === 0) {
        console.log("No archived projects.");
        return;
      }

      for (const proj of projects) {
        const fm = proj.frontmatter;
        const outcome = fm.cancelled ? "cancelled" : "completed";
        const reason = fm.cancelled ? `  "${fm["cancelled-reason"]}"` : "";
        console.log(
          `${fm.name.padEnd(25)} ${outcome.padEnd(11)} ${fm.updated}${reason}`,
        );
      }
    } else {
      const projects = listActiveProjects();

      if (opts.json) {
        console.log(
          JSON.stringify(
            {
              status: "ok",
              data: projects.map((p) => {
                const fm = p.frontmatter;
                const phase = fm.phase as string;
                const template = loadInstalledTemplate(fm.flow);
                const gates = getPhaseGates(p.rawContent, phase);
                const signoffGate = gates.find((g) => g.label.includes("Owner sign-off"));
                const phaseIsHumanGate = template ? isHumanGate(phase, template) : phase === "review";
                const nonSignoffGates = signoffGate
                  ? gates.filter((g) => !g.label.includes("Owner sign-off"))
                  : gates;
                const allNonSignoffMet = nonSignoffGates.length > 0 && nonSignoffGates.every((g) => g.checked);
                const gatesMet = phaseIsHumanGate ? allNonSignoffMet : allGatesMet(p.rawContent, phase);

                return {
                  ...fm,
                  gates: countGates(p.rawContent, phase),
                  "all-gates-met": gatesMet,
                  "is-terminal": template ? isTerminal(phase, template) : phase === "final-review",
                  "is-human-gate": phaseIsHumanGate,
                  "has-owner-signoff": signoffGate ? signoffGate.checked : true,
                  "next-phase": template ? nextPhaseFromTemplate(phase, template) : nextPhase(phase),
                };
              }),
            },
            null,
            2,
          ),
        );
        return;
      }

      if (projects.length === 0) {
        console.log("No active projects.");
        return;
      }

      for (const proj of projects) {
        const fm = proj.frontmatter;
        const { checked, total } = countGates(proj.rawContent, fm.phase as string);
        const niFlag = isNeedsInteractive(fm) ? "  [!]" : "";
        console.log(
          `${fm.name.padEnd(25)} ${(fm.phase as string).padEnd(15)} ${fm.flow.padEnd(28)} ${checked}/${total}  pri:${fm.priority}${niFlag}`,
        );
      }
    }
  });

// --- touch ---

program
  .command("touch")
  .description("Update the 'updated' timestamp to local now")
  .argument("<name>", "Project name")
  .action((name: string) => {
    const proj = readProject(name);
    if (!proj) {
      console.error(`Project '${name}' not found in active pipeline`);
      process.exit(1);
    }
    const now = localTimestamp();
    updateProject(name, { updated: now });
    console.log(`${name}: updated → ${now}`);
  });

// --- approve ---

program
  .command("approve")
  .description("Sign off on a human-gate phase (review, evaluate, deploy, etc.)")
  .argument("<name>", "Project name")
  .option("--yes", "Answer yes to a yes-no gate")
  .option("--no", "Answer no to a yes-no gate (triggers cancel/shelve)")
  .option("--answer <text>", "Provide text for a text gate")
  .action((name: string, opts: { yes?: boolean; no?: boolean; answer?: string }) => {
    const proj = readProject(name);
    if (!proj) {
      console.error(`Project '${name}' not found in active pipeline`);
      process.exit(1);
    }

    const phase = proj.frontmatter.phase;
    const template = loadInstalledTemplate(proj.frontmatter.flow);

    // Check if current phase is a human-gate (flow-aware, falls back to "review")
    const isHuman = template
      ? isHumanGate(phase, template)
      : phase === "review";

    if (!isHuman) {
      console.error(
        `Project '${name}' is in ${phase} phase, which is not a human-gate phase. Cannot approve.`,
      );
      process.exit(1);
    }

    const gates = getPhaseGates(proj.rawContent, phase);

    // Find the pending human-input gate (yes-no or text that needs answering)
    const pendingHumanGate = gates.find(
      (g) => !g.checked && (g.type === "yes-no" || g.type === "text"),
    );

    // If --yes, --no, or --answer provided, handle the specific gate type
    if (opts.yes || opts.no) {
      if (!pendingHumanGate || pendingHumanGate.type !== "yes-no") {
        console.error(
          `Project '${name}' has no pending yes-no gate in ${phase} phase.`,
        );
        process.exit(1);
      }
      const answer = opts.yes ? "yes" : "no";
      answerGate(name, pendingHumanGate.label, answer, "yes-no");
      console.log(`\u2713 Gate answered: ${pendingHumanGate.label} → ${answer}`);

      if (opts.no) {
        // Determine on-no behavior from flow spec
        let onNo: "cancel" | "shelve" = "cancel";
        if (template) {
          const flowGate = getFlowGateByLabel(phase, pendingHumanGate.label, template, proj.frontmatter["project-type"]);
          if (flowGate?.onNo) onNo = flowGate.onNo;
        }

        const ts = timestamp();
        if (onNo === "shelve") {
          // Shelve: archive without cancelling
          appendPhaseHistory(
            name,
            `${ts} — Gate "${pendingHumanGate.label}" answered no → shelved`,
          );
          updateProject(name, { updated: ts });
          try { moveToArchive(name); } catch { /* may already be archived */ }
          console.log(`\u2713 Project shelved (archived).`);
        } else {
          // Cancel
          updateProject(name, {
            cancelled: true,
            "cancelled-reason": `Gate "${pendingHumanGate.label}" answered no`,
            "cancelled-at": ts,
            "cancelled-from": phase,
            updated: ts,
          });
          appendPhaseHistory(
            name,
            `${ts} — Gate "${pendingHumanGate.label}" answered no → cancelled`,
          );
          console.log(`\u2713 Project cancelled.`);
        }

        try {
          const data = JSON.stringify({ project: name, phase, answer: "no", onNo, flow: proj.frontmatter.flow });
          execSync(
            `eventlog emit "pipeline.gate.answered-no" --source pipeline --data '${data}'`,
            { stdio: "pipe", timeout: 5000 },
          );
        } catch { /* fire-and-forget */ }
        console.log("Logged in Phase History.");
        return;
      }

      // --yes: fall through to advance logic
      const ts = timestamp();
      appendPhaseHistory(
        name,
        `${ts} — Gate "${pendingHumanGate.label}" answered yes`,
      );

      const next = nextPhase(phase, template ?? undefined);
      if (next) {
        updateProject(name, { phase: next, updated: ts, "approved-at": ts });
        appendPhaseHistory(name, `${ts} — Owner approved. Phase: ${phase} → ${next}`);
        console.log(`\u2713 Phase advanced: ${phase} \u2192 ${next}`);
      } else {
        updateProject(name, { updated: ts, "approved-at": ts });
        appendPhaseHistory(name, `${ts} — Owner approved (terminal phase: ${phase})`);
      }

      try {
        const data = JSON.stringify({ project: name, phase, answer: "yes", flow: proj.frontmatter.flow });
        execSync(
          `eventlog emit "pipeline.review.approved" --source pipeline --data '${data}'`,
          { stdio: "pipe", timeout: 5000 },
        );
      } catch { /* fire-and-forget */ }
      console.log("Logged in Phase History.");
      return;
    }

    if (opts.answer !== undefined) {
      if (!pendingHumanGate || pendingHumanGate.type !== "text") {
        console.error(
          `Project '${name}' has no pending text gate in ${phase} phase.`,
        );
        process.exit(1);
      }
      if (!opts.answer.trim()) {
        console.error("Answer text cannot be empty.");
        process.exit(1);
      }
      answerGate(name, pendingHumanGate.label, opts.answer, "text");
      console.log(`\u2713 Gate answered: ${pendingHumanGate.label} ${opts.answer}`);

      const ts = timestamp();
      appendPhaseHistory(
        name,
        `${ts} — Gate "${pendingHumanGate.label}" answered: ${opts.answer}`,
      );

      // Check if all gates are now met after answering text gate
      const updatedProj = readProject(name);
      if (updatedProj) {
        const updatedGates = getPhaseGates(updatedProj.rawContent, phase);
        const stillUnchecked = updatedGates.filter((g) => !g.checked);
        if (stillUnchecked.length === 0) {
          const next = nextPhase(phase, template ?? undefined);
          if (next) {
            updateProject(name, { phase: next, updated: ts, "approved-at": ts });
            appendPhaseHistory(name, `${ts} — All gates met. Phase: ${phase} → ${next}`);
            console.log(`\u2713 Phase advanced: ${phase} \u2192 ${next}`);
          } else {
            updateProject(name, { updated: ts, "approved-at": ts });
          }
        } else {
          updateProject(name, { updated: ts });
        }
      }

      try {
        const data = JSON.stringify({ project: name, phase, answer: opts.answer, flow: proj.frontmatter.flow });
        execSync(
          `eventlog emit "pipeline.gate.answered" --source pipeline --data '${data}'`,
          { stdio: "pipe", timeout: 5000 },
        );
      } catch { /* fire-and-forget */ }
      console.log("Logged in Phase History.");
      return;
    }

    // Default: checkbox sign-off (original behavior)
    // Only block on checkbox gates that appear BEFORE Owner sign-off.
    // Gates after sign-off (merge PR, deploy, verify, close issue) run post-approval.
    const signOffIndex = gates.findIndex((g) => g.label.includes("Owner sign-off"));
    const gatesBeforeSignOff = signOffIndex >= 0 ? gates.slice(0, signOffIndex) : gates;
    const uncheckedBeforeSignOff = gatesBeforeSignOff.filter(
      (g) => !g.checked && g.type === "checkbox",
    );
    if (uncheckedBeforeSignOff.length > 0) {
      console.error(
        `Project '${name}' has unchecked ${phase} gates: ${uncheckedBeforeSignOff.map((g) => g.label).join(", ")}`,
      );
      process.exit(1);
    }

    // Check for unanswered yes-no/text gates that must be answered first
    const unansweredRich = gates.filter(
      (g) => !g.checked && (g.type === "yes-no" || g.type === "text"),
    );
    if (unansweredRich.length > 0) {
      const gate = unansweredRich[0];
      if (gate.type === "yes-no") {
        console.error(
          `Project '${name}' has a pending yes-no gate: "${gate.label}". Use --yes or --no.`,
        );
      } else {
        console.error(
          `Project '${name}' has a pending text gate: "${gate.label}". Use --answer "<text>".`,
        );
      }
      process.exit(1);
    }

    checkGate(name, "Owner sign-off");

    const next = nextPhase(phase, template ?? undefined);
    const ts = timestamp();
    if (next) {
      updateProject(name, {
        phase: next,
        updated: ts,
        "approved-at": ts,
      });
      appendPhaseHistory(
        name,
        `${ts} — Owner approved. Phase: ${phase} → ${next}`,
      );
      console.log(`Approved: ${name}`);
      console.log("\u2713 Owner sign-off gate checked");
      console.log(`\u2713 Phase advanced: ${phase} \u2192 ${next}`);

      try {
        const data = JSON.stringify({ project: name, phase, nextPhase: next, flow: proj.frontmatter.flow });
        execSync(
          `eventlog emit "pipeline.review.approved" --source pipeline --data '${data}'`,
          { stdio: "pipe", timeout: 5000 },
        );
      } catch {
        // fire-and-forget
      }
    } else {
      updateProject(name, {
        updated: ts,
        "approved-at": ts,
      });
      appendPhaseHistory(
        name,
        `${ts} — Owner approved (terminal phase: ${phase})`,
      );
      console.log(`Approved: ${name}`);
      console.log("\u2713 Owner sign-off gate checked");

      try {
        const data = JSON.stringify({ project: name, phase, flow: proj.frontmatter.flow });
        execSync(
          `eventlog emit "pipeline.review.approved" --source pipeline --data '${data}'`,
          { stdio: "pipe", timeout: 5000 },
        );
      } catch {
        // fire-and-forget
      }
    }
    console.log("Logged in Phase History.");
  });

// --- unblock ---

program
  .command("unblock")
  .description("Clear needs-interactive flag after human resolution")
  .argument("<name>", "Project name")
  .action((name: string) => {
    const proj = readProject(name);
    if (!proj) {
      if (readArchivedProject(name)) {
        console.error(`Project '${name}' is archived. Cannot unblock.`);
      } else {
        console.error(`Project '${name}' not found in active pipeline`);
      }
      process.exit(1);
    }

    if (!isNeedsInteractive(proj.frontmatter)) {
      console.log(`Project '${name}' is not flagged as needs-interactive. No changes made.`);
      return;
    }

    const projectDir = getProjectDir(name);
    clearNeedsInteractive(projectDir);

    console.log(`Unblocked: ${name}`);
    console.log("\u2713 needs-interactive cleared");
    console.log("\u2713 needs-interactive.md removed");
    console.log("\u2713 Updated timestamp refreshed");
  });

// --- advance ---

program
  .command("advance")
  .description("Manually advance to next phase")
  .argument("<name>", "Project name")
  .action((name: string) => {
    const proj = readProject(name);
    if (!proj) {
      console.error(`Project '${name}' not found`);
      process.exit(1);
    }

    const phase = proj.frontmatter.phase;
    if (phase === "cancelled") {
      console.error(`Project '${name}' is cancelled`);
      process.exit(1);
    }

    const phaseTyped = phase as Phase;
    const next = nextPhase(phaseTyped);
    if (!next) {
      console.error(
        `Project '${name}' is in ${phase} phase (final). Use 'pipeline archive' to complete.`,
      );
      process.exit(1);
    }

    if (phaseTyped === "test") {
      const defects = listDefects(getProjectDir(name));
      const openDefects = defects.filter(
        (d) => d.status === "open" || d.status === "fixed",
      );
      if (openDefects.length > 0) {
        console.error(
          `Project '${name}' is in test phase with open defects. Fix defects first.`,
        );
        process.exit(1);
      }
    }

    const { checked, total } = countGates(proj.rawContent, phaseTyped);
    if (checked < total) {
      console.log(
        `\u26A0 Warning: ${total - checked}/${total} ${phaseTyped} gates unmet:`,
      );
      const gates = getPhaseGates(proj.rawContent, phaseTyped);
      for (const g of gates) {
        if (!g.checked) console.log(`  [ ] ${g.label}`);
      }
    }

    const ts = timestamp();
    updateProject(name, { phase: next, updated: timestamp() });
    appendPhaseHistory(name, `${ts} — Phase: ${phaseTyped} → ${next}`);

    if (checked < total) {
      console.log(`Advanced anyway: ${name}`);
    } else {
      console.log(`Advanced: ${name}`);
    }
    console.log(`Phase: ${phaseTyped} \u2192 ${next}`);
    console.log("Logged in Phase History.");

    try {
      const data = JSON.stringify({ project: name, from: phaseTyped, to: next, flow: proj.frontmatter.flow });
      execSync(
        `eventlog emit "pipeline.phase.advanced" --source pipeline --data '${data}'`,
        { stdio: "pipe", timeout: 5000 },
      );
    } catch {
      // fire-and-forget
    }

    postMemo(
      `${name}: ${phaseTyped} → ${next}`,
      `Pipeline project **${name}** manually advanced from ${phaseTyped} to ${next}.`,
      { tags: "pipeline, phase-change", related: name },
    );
  });

// --- send-back ---

program
  .command("send-back")
  .description("Send project back to previous phase")
  .argument("<name>", "Project name")
  .argument("<reason>", "Reason for sending back")
  .action((name: string, reason: string) => {
    const proj = readProject(name);
    if (!proj) {
      console.error(`Project '${name}' not found`);
      process.exit(1);
    }

    const phase = proj.frontmatter.phase as Phase;
    const prev = prevPhase(phase);
    if (!prev) {
      console.error(
        `Project '${name}' is in ${phase} phase. Cannot send back further.`,
      );
      process.exit(1);
    }

    const ts = timestamp();
    updateProject(name, { phase: prev, updated: timestamp() });
    uncheckPhaseGates(name, prev);
    appendPhaseHistory(
      name,
      `${ts} — Sent back: ${phase} → ${prev}. Reason: ${reason}`,
    );

    const reviewNotesPath = join(getProjectDir(name), "review-notes.md");
    const noteEntry = `\n## [${ts}] Send-back: ${phase} → ${prev}\n\n${reason}\n`;
    if (existsSync(reviewNotesPath)) {
      appendFileSync(reviewNotesPath, noteEntry, "utf-8");
    } else {
      writeFileSync(
        reviewNotesPath,
        `# Review Notes\n${noteEntry}`,
        "utf-8",
      );
    }

    console.log(`Sent back: ${name}`);
    console.log(`Phase: ${phase} \u2192 ${prev}`);
    console.log(`Reason: "${reason}"`);
    console.log(`${prev.charAt(0).toUpperCase() + prev.slice(1)} gates unchecked for rework.`);
    console.log("Appended to review-notes.md.");
    console.log("Logged in Phase History.");
  });

// --- bug ---

program
  .command("bug")
  .description("File a defect against a project")
  .argument("[name]", "Project name (omit with --new)")
  .argument("[description]", "Defect description")
  .option("--new", "Create standalone bugfix project")
  .option("--severity <level>", "low, medium, high, critical", "medium")
  .action(
    (
      name: string | undefined,
      description: string | undefined,
      opts,
    ) => {
      const severity = opts.severity;
      if (!["low", "medium", "high", "critical"].includes(severity)) {
        console.error(
          `Invalid severity '${severity}'. Must be: low, medium, high, critical`,
        );
        process.exit(2);
      }

      if (opts.new) {
        const desc = name
          ? [name, description].filter(Boolean).join(" ")
          : description || "";
        if (!desc) {
          console.error("Description required for --new bug");
          process.exit(2);
        }

        const projectName = slugify(desc);
        // Use default flow template for bugfix projects
        const defaultTemplate = listInstalledTemplates().find((t) => t.default);
        const bugFlowName = defaultTemplate ? defaultTemplate.name : "point-release";
        const bugFlowSlug = bugFlowName.toLowerCase().replace(/\./g, "-");
        const projectDir = getFlowProjectDir(bugFlowSlug, projectName);
        mkdirSync(projectDir, { recursive: true });
        mkdirSync(join(projectDir, "defects"), { recursive: true });

        const projectMd = generateBugfixProjectMd(
          projectName,
          desc,
          "cli",
          3,
          today(),
        );
        writeFileSync(join(projectDir, "project.md"), projectMd, "utf-8");

        const defectFile = `${today()}-${projectName}.md`;
        const defectMd = generateDefectMd(desc, severity, today());
        writeFileSync(
          join(projectDir, "defects", defectFile),
          defectMd,
          "utf-8",
        );

        writeFileSync(
          join(projectDir, "discussion.md"),
          "# Discussion Log\n",
          "utf-8",
        );

        console.log(`Created bugfix project: ${projectName}`);
        console.log("Phase: implement (skipped design/review)");
        console.log(`Defect: ${projectName}/defects/${defectFile}`);
        console.log(`Severity: ${severity}`);
      } else {
        if (!name) {
          console.error("Project name required (or use --new)");
          process.exit(2);
        }
        if (!description) {
          console.error("Defect description required");
          process.exit(2);
        }

        let projectDir = getProjectDir(name);
        let isArchived = false;

        if (!existsSync(projectDir)) {
          const archivedDir = getArchivedProjectDir(name);
          if (existsSync(archivedDir)) {
            isArchived = true;
            console.log(`Project '${name}' is archived. Reactivating...`);
            moveFromArchive(name);
            projectDir = getProjectDir(name);
            updateProject(name, { phase: "implement", updated: timestamp() });
            appendPhaseHistory(
              name,
              `${timestamp()} — Reactivated from archive for bug fix`,
            );
          } else {
            console.error(
              `Project '${name}' not found in active or archive`,
            );
            process.exit(1);
          }
        }

        mkdirSync(join(projectDir, "defects"), { recursive: true });
        const defectSlug = slugify(description);
        const defectFile = `${today()}-${defectSlug}.md`;
        const defectMd = generateDefectMd(description, severity, today());
        writeFileSync(
          join(projectDir, "defects", defectFile),
          defectMd,
          "utf-8",
        );

        console.log(`Filed defect: ${name}/defects/${defectFile}`);
        console.log(`Severity: ${severity}`);
        console.log("Status: open");
        if (isArchived) {
          console.log("Reactivated. Phase set to implement.");
        }
      }
    },
  );

// --- cancel ---

program
  .command("cancel")
  .description("Cancel a project")
  .argument("<name>", "Project name")
  .argument("<reason>", "Reason for cancellation")
  .action((name: string, reason: string) => {
    const proj = readProject(name);
    if (!proj) {
      if (existsSync(getArchivedProjectDir(name))) {
        console.error(`Project '${name}' is already archived`);
      } else {
        console.error(`Project '${name}' not found in active pipeline`);
      }
      process.exit(1);
    }

    const ts = timestamp();
    const phase = proj.frontmatter.phase;

    updateProject(name, {
      phase: "cancelled",
      cancelled: true,
      "cancelled-reason": reason,
      "cancelled-at": ts,
      "cancelled-from": phase as string,
      updated: timestamp(),
    });
    appendPhaseHistory(
      name,
      `${ts} — Cancelled from ${phase} phase. Reason: ${reason}`,
    );

    moveToArchive(name);

    try {
      const data = JSON.stringify({ project: name, reason, from: phase });
      execSync(
        `eventlog emit "pipeline.project.cancelled" --source pipeline --data '${data}'`,
        { stdio: "pipe", timeout: 5000 },
      );
    } catch {
      // fire-and-forget — never break pipeline for event emission
    }

    console.log(`Cancelled: ${name}`);
    console.log(`Reason: "${reason}"`);
    console.log(`Cancelled from: ${phase} phase`);
    console.log(`Moved to: ${getArchivedProjectDir(name)}/`);

    postMemo(
      `${name}: cancelled`,
      `Pipeline project **${name}** cancelled from ${phase} phase. Reason: ${reason}`,
      { tags: "pipeline, cancelled", related: name },
    );
  });

// --- open ---

program
  .command("open")
  .description("Open project files")
  .argument("<name>", "Project name")
  .argument(
    "[artifact]",
    "Specific artifact: design, use-cases, cli-spec, acceptance, review-notes, defects, test-results, project, discussion",
  )
  .action((name: string, artifact: string | undefined) => {
    let projectDir = getProjectDir(name);
    if (!existsSync(projectDir)) {
      projectDir = getArchivedProjectDir(name);
      if (!existsSync(projectDir)) {
        console.error(`Project '${name}' not found`);
        process.exit(1);
      }
    }

    if (!artifact) {
      execSync(`open "${projectDir}"`, { stdio: "inherit" });
      return;
    }

    const artifactMap: Record<string, string> = {
      design: "design.md",
      "use-cases": "use-cases.md",
      "cli-spec": "cli-spec.md",
      acceptance: "acceptance-criteria.md",
      "review-notes": "review-notes.md",
      defects: "defects",
      "test-results": "test-results",
      project: "project.md",
      discussion: "discussion.md",
      "final-review": "final-review.md",
    };

    const fileName = artifactMap[artifact];
    if (!fileName) {
      console.error(
        `Unknown artifact '${artifact}'. Valid: ${Object.keys(artifactMap).join(", ")}`,
      );
      process.exit(2);
    }

    const filePath = join(projectDir, fileName);
    if (!existsSync(filePath)) {
      console.error(
        `Artifact '${artifact}' does not exist yet for project '${name}'`,
      );
      process.exit(1);
    }

    execSync(`open "${filePath}"`, { stdio: "inherit" });
  });

// --- archive ---

program
  .command("archive")
  .description("Manually archive a completed project")
  .argument("<name>", "Project name")
  .option("--force", "Archive even with open defects")
  .action((name: string, opts) => {
    const proj = readProject(name);
    if (!proj) {
      console.error(`Project '${name}' not found`);
      process.exit(1);
    }

    if (!opts.force) {
      const defects = listDefects(getProjectDir(name));
      const openDefects = defects.filter((d) => d.status === "open");
      if (openDefects.length > 0) {
        console.error(
          `Project '${name}' has open defects. Fix or close them first.`,
        );
        console.error("Use --force to override.");
        process.exit(1);
      }
    }

    const ts = timestamp();
    updateProject(name, { updated: timestamp() });
    appendPhaseHistory(name, `${ts} — Archived (completed)`);

    moveToArchive(name);

    console.log(`Archived: ${name}`);
    console.log("Outcome: completed");
    console.log(`Moved to: ${getArchivedProjectDir(name)}/`);

    try {
      const data = JSON.stringify({ project: name, flow: proj.frontmatter.flow });
      execSync(
        `eventlog emit "pipeline.project.archived" --source pipeline --data '${data}'`,
        { stdio: "pipe", timeout: 5000 },
      );
    } catch {
      // fire-and-forget
    }

    postMemo(
      `${name}: archived`,
      `Pipeline project **${name}** manually archived (completed).`,
      { tags: "pipeline, archived", related: name },
    );
  });

// --- template ---

program
  .command("template")
  .description("Print default project template")
  .option("--type <type>", "Show template for specific type", "cli")
  .action((opts) => {
    const type = opts.type as ProjectType;
    if (!VALID_TYPES.includes(type)) {
      console.error(
        `Invalid type '${type}'. Must be: ${VALID_TYPES.join(", ")}`,
      );
      process.exit(2);
    }
    const template = generateProjectMd(
      "<project-name>",
      "<description>",
      type,
      3,
      "<date>",
    );
    console.log(template);
  });

// --- idea ---

program
  .command("idea")
  .description("Create a new project in design phase from a one-liner")
  .argument("<description...>", "Idea description")
  .action((words: string[]) => {
    const description = words.join(" ");
    const name = slugify(description);

    if (findProjectDir(name)) {
      console.error(`Project '${name}' already exists`);
      process.exit(1);
    }

    // Use default flow template
    const defaultTemplate = listInstalledTemplates().find((t) => t.default);
    const flowName = defaultTemplate ? defaultTemplate.name : "point-release";
    const flowSlug = flowName.toLowerCase().replace(/\./g, "-");
    const projectDir = getFlowProjectDir(flowSlug, name);
    mkdirSync(projectDir, { recursive: true });
    const projectMd = generateProjectMd(name, description, "cli", 3, today(), flowName);
    writeFileSync(join(projectDir, "project.md"), projectMd, "utf-8");
    writeFileSync(
      join(projectDir, "discussion.md"),
      "# Discussion Log\n",
      "utf-8",
    );

    console.log(`Created project: ${name}`);
    console.log(`  Description: ${description}`);
    console.log(`  Phase: design`);
    console.log(`  Directory: ${projectDir}/`);
  });

// --- ideas ---

program
  .command("ideas")
  .description("List all projects in design phase")
  .action(() => {
    const projects = listActiveProjects();
    const ideas = projects.filter((p) => p.frontmatter.phase === "design");

    if (ideas.length === 0) {
      console.log("No projects in design phase.");
      return;
    }

    for (const proj of ideas) {
      const fm = proj.frontmatter;
      const { checked, total } = countGates(proj.rawContent, "design");
      console.log(
        `${fm.name.padEnd(25)} ${checked}/${total} gates  pri:${fm.priority}  ${fm.description}`,
      );
    }
  });

// --- flow ---

const flowCmd = program
  .command("flow")
  .description("Manage flow specifications");

flowCmd
  .command("list")
  .description("List installed flow templates")
  .action(() => {
    const templates = listInstalledTemplates();

    if (templates.length === 0) {
      console.log("No flow templates installed. Run 'pipeline init' first.");
      return;
    }

    console.log("Installed flow templates:");
    for (const t of templates) {
      const defaultTag = t.default ? " (default)" : "";
      console.log(`  ${t.name.padEnd(20)} ${t.phases.length} phases${defaultTag}`);
      console.log(`    ${t.description}`);
    }
  });

flowCmd
  .command("show")
  .description("Show details of a flow template")
  .argument("<name>", "Flow template name")
  .action((name: string) => {
    const template = loadInstalledTemplate(name);
    if (!template) {
      console.error(`Flow template '${name}' not found`);
      process.exit(1);
    }

    console.log(`${template.name}`);
    console.log("=".repeat(template.name.length));
    console.log(`Description: ${template.description}`);
    console.log(`Default:     ${template.default}`);
    console.log(`Phases:      ${template.phases.length}`);

    for (const phase of template.phases) {
      const flags: string[] = [];
      if (phase.entryPoint) flags.push("entry-point");
      if (phase.terminal) flags.push("terminal");
      if (phase.autoArchive) flags.push("auto-archive");
      if (phase.humanGate) flags.push("human-gate");
      if (phase.skipIf) flags.push(`skip-if: ${phase.skipIf}`);
      const flagStr = flags.length > 0 ? ` (${flags.join(", ")})` : "";

      console.log(`\n  ${phase.name}${flagStr}`);
      if (phase.worker) console.log(`    worker: ${phase.worker}`);
      for (const gate of phase.gates) {
        console.log(`    - ${gate.label}`);
        if (gate.verify) console.log(`      verify: ${gate.verify}`);
      }
      if (phase.gateVariants) {
        console.log(`    variants by: ${phase.gateVariants.by}`);
        for (const [key, val] of Object.entries(phase.gateVariants)) {
          if (key === "by") continue;
          if (Array.isArray(val)) {
            console.log(`      ${key}: ${val.length} extra gates`);
          }
        }
      }
    }

    if (Object.keys(template.workers).length > 0) {
      console.log("\nWorkers:");
      for (const [name, config] of Object.entries(template.workers)) {
        console.log(`  ${name}: ${config.prompt}`);
      }
    }

    const features = template.features;
    console.log("\nFeatures:");
    console.log(`  discussion-log: ${features.discussionLog}`);
    console.log(`  defect-cycle:   ${features.defectCycle}`);
    console.log(`  bug-intake:     ${features.bugIntake}`);
    console.log(`  cancellation:   ${features.cancellation}`);
  });

flowCmd
  .command("install")
  .description("Install a flow template from a YAML file")
  .argument("<path>", "Path to the YAML template file")
  .action((filePath: string) => {
    if (!existsSync(filePath)) {
      console.error(`File not found: ${filePath}`);
      process.exit(1);
    }

    const result = installTemplate(filePath);
    if (!result.success) {
      console.error(`Install failed: ${result.error}`);
      process.exit(1);
    }

    console.log(`Installed flow template: ${result.template!.name}`);
    console.log(`  Phases: ${result.template!.phases.length}`);
    console.log(`  Default: ${result.template!.default}`);
  });

flowCmd
  .command("uninstall")
  .description("Uninstall a flow template")
  .argument("<name>", "Flow template name")
  .action((name: string) => {
    const result = uninstallTemplate(name);
    if (!result.success) {
      console.error(result.error);
      process.exit(1);
    }

    console.log(`Uninstalled flow template: ${name}`);
  });

flowCmd
  .command("validate")
  .description("Validate a flow template YAML file")
  .argument("<path>", "Path to the YAML template file")
  .action((filePath: string) => {
    if (!existsSync(filePath)) {
      console.error(`File not found: ${filePath}`);
      process.exit(1);
    }

    const result = validateTemplateFile(filePath);

    if (result.valid) {
      console.log(`Valid: ${result.phaseCount} phases, ${result.gateCount} gates`);
    } else {
      console.error("Validation failed:");
      for (const err of result.errors) {
        const loc = [err.phase, err.gate].filter(Boolean).join(" > ");
        console.error(`  ERROR: ${err.message}${loc ? ` [${loc}]` : ""}`);
      }
      process.exit(1);
    }

    if (result.warnings.length > 0) {
      for (const warn of result.warnings) {
        console.log(`  WARNING: ${warn.message}`);
      }
    }
  });

flowCmd
  .command("init")
  .description("Scaffold a new flow template YAML file")
  .argument("<name>", "Flow template name (kebab-case)")
  .action((name: string) => {
    const fileName = `${name}.yaml`;
    if (existsSync(fileName)) {
      console.error(`File '${fileName}' already exists`);
      process.exit(1);
    }

    const content = generateInitTemplate(name);
    writeFileSync(fileName, content, "utf-8");
    console.log(`Created template scaffold: ${fileName}`);
    console.log("Edit the file, then install with: pipeline flow install " + fileName);
  });

flowCmd
  .command("fork")
  .description("Copy an installed template for customization")
  .argument("<source>", "Source template name")
  .argument("<target>", "New template name")
  .action((source: string, target: string) => {
    const result = forkTemplate(source, target);
    if (!result.success) {
      console.error(result.error);
      process.exit(1);
    }

    console.log(`Forked '${source}' as '${target}'`);
    console.log(`  File: ${result.filePath}`);
    console.log("Edit the file, then install with: pipeline flow install " + result.filePath);
  });

flowCmd
  .command("migrate")
  .description("Upgrade a project to the latest template version")
  .argument("<project>", "Project name")
  .action((projectName: string) => {
    const proj = readProject(projectName);
    if (!proj) {
      console.error(`Project '${projectName}' not found`);
      process.exit(1);
    }

    const flowName = proj.frontmatter.flow || "sdlc";
    const template = loadInstalledTemplate(flowName);
    if (!template) {
      console.error(`Flow template '${flowName}' not found`);
      process.exit(1);
    }

    const currentVersion = parseInt(String(proj.frontmatter["flow-version"] || "1"), 10);
    const projectDir = getProjectDir(projectName);
    const projectFile = getProjectFile(projectName);

    const result = migrateProject(projectDir, projectFile, currentVersion, template);
    if (!result.success) {
      console.error(`Migration failed: ${result.error}`);
      process.exit(1);
    }

    console.log(`Migrated: ${projectName}`);
    for (const change of result.changes) {
      console.log(`  ${change}`);
    }
  });

flowCmd
  .command("add")
  .description("Add a new flow spec from a directory")
  .argument("<path>", "Path to the flow spec directory to install")
  .action((srcPath: string) => {
    if (!existsSync(srcPath)) {
      console.error(`Source directory not found: ${srcPath}`);
      process.exit(1);
    }

    const name = basename(srcPath);
    const specDir = getSpecDir();
    mkdirSync(specDir, { recursive: true });

    const destDir = join(specDir, name);
    if (existsSync(destDir)) {
      console.error(`Flow spec '${name}' already installed at ${destDir}`);
      process.exit(1);
    }

    cpSync(srcPath, destDir, { recursive: true });
    console.log(`Installed flow spec: ${name}`);
    console.log(`  Location: ${destDir}`);
  });

// --- supervise ---

program
  .command("supervise")
  .description("Supervise active projects — advance, queue work, archive")
  .option("--dry-run", "Show what would happen without taking action", false)
  .option("--limit <n>", "Max projects to queue work for per run", "3")
  .option("--json", "Output structured JSON summary", false)
  .option("--verbose", "Show per-project decision details", false)
  .option("--prompt-queue", "Also supervise prompt-queue projects", false)
  .option("--no-notify", "Skip sending notifications")
  .option("--no-queue", "Skip queuing work (only advance/archive)")
  .action((opts) => {
    const limit = parseInt(opts.limit, 10);
    if (isNaN(limit) || limit < 1) {
      console.error("--limit must be a positive integer");
      process.exit(2);
    }
    runSupervise(
      {
        limit,
        promptQueue: opts.promptQueue,
        notify: opts.notify !== false,
        queue: opts.queue !== false,
      },
      opts.dryRun,
      opts.verbose,
      opts.json,
    );
  });

program.parse();
