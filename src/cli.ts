#!/usr/bin/env node

import { Command } from "commander";
import {
  existsSync,
  mkdirSync,
  writeFileSync,
  readdirSync,
  renameSync,
  appendFileSync,
} from "node:fs";
import { execSync } from "node:child_process";
import { join } from "node:path";

import type { Phase, ProjectType } from "./types.js";
import { VALID_TYPES, PHASES } from "./types.js";
import {
  getPipelineDir,
  getActiveDir,
  getArchiveDir,
  getProjectDir,
  getArchivedProjectDir,
  getProjectFile,
  getTemplateFile,
  getResearchBotDir,
  getPromptQueueProjectsDir,
} from "./paths.js";
import {
  readProject,
  listActiveProjects,
  listArchivedProjects,
  parseGates,
  getPhaseGates,
  countGates,
  allGatesMet,
  updateProject,
  checkGate,
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
} from "./project.js";
import { generateProjectMd, generateBugfixProjectMd, generateDefectMd } from "./template.js";
import { installSkill } from "./templates/skill.md.js";

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
    const activeDir = getActiveDir();
    const archiveDir = getArchiveDir();

    if (existsSync(activeDir) && existsSync(archiveDir) && !opts.migrate) {
      console.log(`Pipeline already initialized at ${pipelineDir}. No changes made.`);
      return;
    }

    if (!existsSync(activeDir)) {
      mkdirSync(activeDir, { recursive: true });
      console.log(`Created ${activeDir}`);
    }
    if (!existsSync(archiveDir)) {
      mkdirSync(archiveDir, { recursive: true });
      console.log(`Created ${archiveDir}`);
    }

    const templateFile = getTemplateFile();
    if (!existsSync(templateFile)) {
      const template = generateProjectMd(
        "<project-name>",
        "<description>",
        "cli",
        3,
        "<date>",
      );
      writeFileSync(templateFile, template, "utf-8");
      console.log(`Written ${templateFile}`);
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

    if (opts.migrate) {
      console.log("\nMigrating existing items...");
      const researchDir = getResearchBotDir();
      const pqProjectsDir = getPromptQueueProjectsDir();
      let activeCount = 0;
      let archiveCount = 0;

      // Migrate design docs from research-bot
      if (existsSync(researchDir)) {
        const files = readdirSync(researchDir).filter(
          (f) =>
            f.endsWith(".md") &&
            !f.startsWith("SDLC-") &&
            !f.startsWith("README"),
        );
        for (const file of files) {
          const name = file.replace(/\.md$/, "");
          const destDir = join(activeDir, name);
          const srcPath = join(researchDir, file);

          if (existsSync(destDir)) continue;

          if (opts.dryRun) {
            console.log(
              `  [DRY RUN] MOVE data/research-bot/${file} → pipeline/active/${name}/design.md`,
            );
          } else {
            mkdirSync(destDir, { recursive: true });
            renameSync(srcPath, join(destDir, "design.md"));
            const projectMd = generateProjectMd(
              name,
              `Migrated from research-bot/${file}`,
              "cli",
              3,
              today(),
            );
            writeFileSync(join(destDir, "project.md"), projectMd, "utf-8");
            console.log(
              `  MOVE data/research-bot/${file} → pipeline/active/${name}/design.md`,
            );
            activeCount++;
          }
        }
      }

      // Migrate completed projects from prompt-queue
      if (existsSync(pqProjectsDir)) {
        const files = readdirSync(pqProjectsDir).filter((f) =>
          f.endsWith(".md"),
        );
        const projectGroups = new Map<string, string[]>();
        for (const file of files) {
          const match = file.match(/^(.+?)(?:-(?:be|fe|api|web|cli))?\.md$/);
          const projectName = match ? match[1] : file.replace(/\.md$/, "");
          if (!projectGroups.has(projectName)) {
            projectGroups.set(projectName, []);
          }
          projectGroups.get(projectName)!.push(file);
        }

        for (const [projectName, projectFiles] of projectGroups) {
          const destDir = join(archiveDir, projectName);
          if (existsSync(destDir)) continue;

          if (opts.dryRun) {
            for (const f of projectFiles) {
              console.log(
                `  [DRY RUN] MOVE data/prompt-queue/projects/${f} → pipeline/archive/${projectName}/${f}`,
              );
            }
          } else {
            mkdirSync(destDir, { recursive: true });
            for (const f of projectFiles) {
              renameSync(
                join(pqProjectsDir, f),
                join(destDir, f),
              );
              console.log(
                `  MOVE data/prompt-queue/projects/${f} → pipeline/archive/${projectName}/${f}`,
              );
            }
            archiveCount++;
          }
        }
      }

      if (opts.dryRun) {
        console.log("No changes made.");
      } else {
        console.log(
          `Migration complete. ${activeCount} active, ${archiveCount} archived.`,
        );
      }
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

    const projectDir = getProjectDir(name);
    if (existsSync(projectDir)) {
      console.error(`Project '${name}' already exists in active pipeline`);
      process.exit(1);
    }

    const archivedDir = getArchivedProjectDir(name);
    if (existsSync(archivedDir)) {
      console.error(
        `Project '${name}' exists in archive. Use --reactivate to restore it.`,
      );
      process.exit(1);
    }

    mkdirSync(projectDir, { recursive: true });
    const projectMd = generateProjectMd(name, description, type, priority, today());
    writeFileSync(getProjectFile(name), projectMd, "utf-8");

    writeFileSync(
      join(projectDir, "discussion.md"),
      "# Discussion Log\n",
      "utf-8",
    );

    console.log(`Created project: ${name}`);
    console.log(`  Type: ${type}`);
    console.log(`  Phase: design`);
    console.log(`  Priority: ${priority}`);
    console.log(`  Directory: ${projectDir}/`);
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
      const timeSinceUpdate = Date.now() - new Date(fm.updated).getTime();
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

      for (const phase of PHASES) {
        const inPhase = projects.filter((p) => p.frontmatter.phase === phase);
        console.log(`\n${phase.toUpperCase()} (${inPhase.length})`);
        if (inPhase.length === 0) continue;
        for (const proj of inPhase) {
          const { checked, total } = countGates(proj.rawContent, phase);
          const updated = timeAgo(proj.frontmatter.updated);
          console.log(
            `  ${proj.frontmatter.name.padEnd(25)} ${checked}/${total} gates   priority:${proj.frontmatter.priority}   updated ${updated}`,
          );
          if (phase === "review") {
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
              data: projects.map((p) => ({
                ...p.frontmatter,
                gates: countGates(p.rawContent, p.frontmatter.phase as string),
              })),
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
        console.log(
          `${fm.name.padEnd(25)} ${(fm.phase as string).padEnd(15)} ${checked}/${total}  pri:${fm.priority}`,
        );
      }
    }
  });

// --- approve ---

program
  .command("approve")
  .description("Sign off on review \u2192 implement transition")
  .argument("<name>", "Project name")
  .action((name: string) => {
    const proj = readProject(name);
    if (!proj) {
      console.error(`Project '${name}' not found in active pipeline`);
      process.exit(1);
    }

    if (proj.frontmatter.phase !== "review") {
      console.error(
        `Project '${name}' is in ${proj.frontmatter.phase} phase, not review. Cannot approve.`,
      );
      process.exit(1);
    }

    const reviewGates = getPhaseGates(proj.rawContent, "review");
    const unchecked = reviewGates.filter(
      (g) => !g.checked && !g.label.includes("Owner sign-off"),
    );
    if (unchecked.length > 0) {
      console.error(
        `Project '${name}' has unchecked review gates: ${unchecked.map((g) => g.label).join(", ")}`,
      );
      process.exit(1);
    }

    checkGate(name, "Owner sign-off");

    const ts = timestamp();
    updateProject(name, {
      phase: "implement",
      updated: today(),
      "approved-at": ts,
    });
    appendPhaseHistory(
      name,
      `${ts} — Owner approved. Phase: review → implement`,
    );

    console.log(`Approved: ${name}`);
    console.log("\u2713 Owner sign-off gate checked");
    console.log("\u2713 Phase advanced: review \u2192 implement");
    console.log("Logged in Phase History.");
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
    updateProject(name, { phase: next, updated: today() });
    appendPhaseHistory(name, `${ts} — Phase: ${phaseTyped} → ${next}`);

    if (checked < total) {
      console.log(`Advanced anyway: ${name}`);
    } else {
      console.log(`Advanced: ${name}`);
    }
    console.log(`Phase: ${phaseTyped} \u2192 ${next}`);
    console.log("Logged in Phase History.");
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
    updateProject(name, { phase: prev, updated: today() });
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
        const projectDir = getProjectDir(projectName);
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
            updateProject(name, { phase: "implement", updated: today() });
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
      updated: today(),
    });
    appendPhaseHistory(
      name,
      `${ts} — Cancelled from ${phase} phase. Reason: ${reason}`,
    );

    moveToArchive(name);

    console.log(`Cancelled: ${name}`);
    console.log(`Reason: "${reason}"`);
    console.log(`Cancelled from: ${phase} phase`);
    console.log(`Moved to: ${getArchivedProjectDir(name)}/`);
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
    updateProject(name, { updated: today() });
    appendPhaseHistory(name, `${ts} — Archived (completed)`);

    moveToArchive(name);

    console.log(`Archived: ${name}`);
    console.log("Outcome: completed");
    console.log(`Moved to: ${getArchivedProjectDir(name)}/`);
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

    if (existsSync(getProjectDir(name))) {
      console.error(`Project '${name}' already exists`);
      process.exit(1);
    }

    const projectDir = getProjectDir(name);
    mkdirSync(projectDir, { recursive: true });
    const projectMd = generateProjectMd(name, description, "cli", 3, today());
    writeFileSync(getProjectFile(name), projectMd, "utf-8");
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

program.parse();
