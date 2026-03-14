import { execSync } from "node:child_process";
import { existsSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import type { ParsedProject } from "./types.js";
import {
  listActiveProjects,
  getPhaseGates,
  allGatesMet,
  countGates,
  updateProject,
  appendPhaseHistory,
  moveToArchive,
  nextPhase,
  timestamp,
  timeAgo,
  parseFrontmatter,
} from "./project.js";
import { getSpecDir, getPromptQueueProjectsDir } from "./paths.js";
import {
  isTerminal,
  isHumanGate,
  loadInstalledTemplate,
} from "./flow.js";
import type { FlowTemplate } from "./flow-types.js";
import {
  decideAction,
  decidePqAction,
  findStaleEntries,
  tally,
  type SuperviseAction,
  type SuperviseResult,
  type SuperviseOptions,
  type ProjectState,
  type PqProject,
  type QueueEntry,
} from "./supervise.js";

// --- Build project state from ParsedProject ---

function toProjectState(proj: ParsedProject, template: FlowTemplate | null): ProjectState {
  const fm = proj.frontmatter;
  const phase = fm.phase;
  const gates = getPhaseGates(proj.rawContent, phase);
  const signoffGate = gates.find((g) => g.label.includes("Owner sign-off"));
  const unchecked = gates.filter((g) => !g.checked).map((g) => g.label);
  const phaseIsHumanGate = template ? isHumanGate(phase, template) : phase === "review";

  // For human-gate phases, "all gates met" means all gates except Owner sign-off
  // are checked. This allows the notify path to fire when only the human gate remains.
  const nonSignoffGates = signoffGate
    ? gates.filter((g) => !g.label.includes("Owner sign-off"))
    : gates;
  const allNonSignoffMet = nonSignoffGates.length > 0 && nonSignoffGates.every((g) => g.checked);
  const gatesMet = phaseIsHumanGate ? allNonSignoffMet : allGatesMet(proj.rawContent, phase);

  const projectDir = proj.filePath.replace(/\/project\.md$/, "");
  const flowSlug = fm.flow.toLowerCase().replace(/\./g, "-");
  const specDir = join(getSpecDir(), flowSlug);

  return {
    name: fm.name,
    phase,
    flow: fm.flow,
    priority: fm.priority,
    updated: fm.updated,
    created: fm.created,
    stuckThresholdMinutes: fm["stuck-threshold-minutes"],
    cancelled: fm.cancelled,
    allGatesMet: gatesMet,
    hasOwnerSignoff: signoffGate ? signoffGate.checked : true,
    isHumanGate: phaseIsHumanGate,
    isTerminal: template ? isTerminal(phase, template) : phase === "final-review",
    uncheckedGateLabels: unchecked,
    projectDir,
    specDir,
  };
}

// --- Parse prompt-queue projects ---

function loadPqProjects(): PqProject[] {
  const dir = getPromptQueueProjectsDir();
  if (!existsSync(dir)) return [];

  const files = readdirSync(dir).filter((f) => f.endsWith(".md"));
  const projects: PqProject[] = [];

  for (const file of files) {
    try {
      const filePath = join(dir, file);
      const content = readFileSync(filePath, "utf-8");
      const fm = parseFrontmatter(content);
      const steps: { text: string; done: boolean }[] = [];

      for (const line of content.split("\n")) {
        const doneMatch = line.match(/^- \[x\] (.+)$/);
        if (doneMatch) {
          steps.push({ text: doneMatch[1], done: true });
          continue;
        }
        const pendingMatch = line.match(/^- \[ \] (.+)$/);
        if (pendingMatch) {
          steps.push({ text: pendingMatch[1], done: false });
        }
      }

      projects.push({
        name: fm["name"] || file.replace(/\.md$/, ""),
        description: fm["description"] || "",
        created: fm["created"] || "",
        updated: fm["updated"] || "",
        stuckThresholdMinutes: parseInt(fm["stuck-threshold-minutes"] || "60", 10),
        status: fm["status"] || "",
        steps,
        filePath,
      });
    } catch {
      // skip malformed files
    }
  }
  return projects;
}

// --- Parse prompt-queue list output ---

function parseQueueList(): QueueEntry[] {
  try {
    const output = execSync("prompt-queue list 2>/dev/null", {
      encoding: "utf-8",
      timeout: 10000,
    }).trim();
    if (!output) return [];

    const entries: QueueEntry[] = [];
    const lines = output.split("\n");
    for (let i = 0; i < lines.length; i++) {
      const match = lines[i].match(/^\s*(\d+)\.\s+(\d{4}-\d{2}-\d{2}\s+\d{2}:\d{2})\s+(.+)$/);
      if (match) {
        entries.push({
          line: parseInt(match[1], 10),
          timestamp: match[2],
          text: match[3],
        });
      }
    }
    return entries;
  } catch {
    return [];
  }
}

// --- Execute actions ---

function executeAction(action: SuperviseAction, dryRun: boolean): void {
  if (dryRun) return;

  switch (action.type) {
    case "advance": {
      const ts = timestamp();
      updateProject(action.project, { phase: action.to, updated: ts });
      appendPhaseHistory(
        action.project,
        `${ts} — Phase: ${action.from} → ${action.to} (auto-advanced by supervisor)`,
      );
      break;
    }
    case "archive": {
      const ts = timestamp();
      updateProject(action.project, { updated: ts });
      appendPhaseHistory(action.project, `${ts} — Archived (completed by supervisor)`);
      try {
        moveToArchive(action.project);
      } catch {
        // may already be archived
      }
      break;
    }
    case "notify": {
      try {
        execSync(
          `notify send ${JSON.stringify(action.message)} --priority ${action.priority}`,
          { stdio: "pipe", timeout: 10000 },
        );
      } catch {
        // non-critical
      }
      break;
    }
    case "queue-work":
    case "queue-step-pq": {
      const ts = timestamp();
      try {
        execSync(`prompt-queue add ${JSON.stringify(action.prompt)}`, {
          stdio: "pipe",
          timeout: 10000,
        });
      } catch {
        // non-critical
      }
      // Update the project's updated field to prevent re-queuing
      if (action.type === "queue-work") {
        updateProject(action.project, { updated: ts });
      } else {
        // For PQ projects, update the file directly
        const pqDir = getPromptQueueProjectsDir();
        const filePath = join(pqDir, `${action.project}.md`);
        if (existsSync(filePath)) {
          try {
            let content = readFileSync(filePath, "utf-8");
            content = content.replace(/^(updated:).*$/m, `$1 ${ts}`);
            writeFileSync(filePath, content, "utf-8");
          } catch {
            // non-critical
          }
        }
      }
      break;
    }
    case "complete-pq": {
      // Set status to complete and archive
      const pqDir = getPromptQueueProjectsDir();
      const filePath = join(pqDir, `${action.project}.md`);
      if (existsSync(filePath)) {
        try {
          let content = readFileSync(filePath, "utf-8");
          if (content.match(/^status:/m)) {
            content = content.replace(/^(status:).*$/m, `$1 complete`);
          } else {
            content = content.replace(/^(---)$/m, `status: complete\n$1`);
          }
          writeFileSync(filePath, content, "utf-8");
        } catch {
          // non-critical
        }
      }
      try {
        execSync(
          `notify send ${JSON.stringify(`prompt-queue project complete: ${action.project}`)} --priority normal`,
          { stdio: "pipe", timeout: 10000 },
        );
      } catch {
        // non-critical
      }
      try {
        execSync(`prompt-queue archive-project ${action.project}`, {
          stdio: "pipe",
          timeout: 10000,
        });
      } catch {
        // may already be archived
      }
      break;
    }
    case "cleanup-stale":
    case "cleanup-duplicate": {
      try {
        execSync(`prompt-queue done ${action.line}`, {
          stdio: "pipe",
          timeout: 10000,
        });
      } catch {
        // non-critical
      }
      break;
    }
  }
}

// --- Format output ---

function formatAction(action: SuperviseAction, dryRun: boolean): string {
  const prefix = dryRun ? "WOULD " : "";
  switch (action.type) {
    case "advance":
      return `  \u2713 ${action.project}: ${prefix}${action.from} \u2192 ${action.to} (all gates met)`;
    case "archive":
      return `  \u2713 ${action.project}: ${prefix}archive (complete)`;
    case "notify":
      return `  \uD83D\uDD14 ${action.project}: ${prefix}notify (awaiting approval)`;
    case "queue-work":
      return `  \u23F3 ${action.project}: ${prefix}queue work (${action.phase})`;
    case "queue-step-pq":
      return `  \u23F3 ${action.project}: ${prefix}queue step (${action.step})`;
    case "complete-pq":
      return `  \u2713 ${action.project}: ${prefix}complete + archive`;
    case "skip":
      return `  \u23F8 ${action.project}: skipped (${action.reason})`;
    case "error":
      return `  \u2717 ${action.project}: error (${action.error})`;
    default:
      return "";
  }
}

function formatVerboseAction(action: SuperviseAction, state?: ProjectState | PqProject): string {
  const base = formatAction(action, false);
  if (!state) return base;

  if ("phase" in state && "flow" in state) {
    // Pipeline project state
    const ps = state as ProjectState;
    const gateInfo = `Gates: ${ps.uncheckedGateLabels.length === 0 ? "all met" : `${ps.uncheckedGateLabels.length} remaining`}`;
    return `${base}\n    Phase: ${ps.phase}, ${gateInfo}`;
  }
  return base;
}

// --- Main runner ---

export function runSupervise(
  options: SuperviseOptions,
  dryRun: boolean,
  verbose: boolean,
  json: boolean,
): SuperviseResult {
  const now = options.now ?? Date.now();
  const actions: SuperviseAction[] = [];
  let queuedCount = 0;

  // --- Pipeline projects ---
  let projects: ParsedProject[];
  try {
    projects = listActiveProjects();
  } catch {
    projects = [];
  }

  // Cache templates by flow name
  const templateCache = new Map<string, FlowTemplate | null>();
  function getTemplate(flowName: string): FlowTemplate | null {
    if (templateCache.has(flowName)) return templateCache.get(flowName)!;
    const t = loadInstalledTemplate(flowName);
    templateCache.set(flowName, t);
    return t;
  }

  for (const proj of projects) {
    try {
      const template = getTemplate(proj.frontmatter.flow);
      const state = toProjectState(proj, template);
      let action = decideAction(state, queuedCount, options.limit, options.queue, now);

      // Resolve "to" phase for advance actions
      if (action.type === "advance") {
        const next = nextPhase(state.phase, template ?? undefined);
        if (next) {
          action = { ...action, to: next };
        } else {
          action = { type: "skip", project: state.name, reason: "active" };
        }
      }

      // Suppress notify if --no-notify
      if (action.type === "notify" && !options.notify) {
        action = { type: "skip", project: state.name, reason: "human-gate-pending" };
      }

      actions.push(action);
      if (action.type === "queue-work") queuedCount++;
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : String(e);
      actions.push({ type: "error", project: proj.frontmatter.name, error: msg });
    }
  }

  // --- Prompt-queue projects ---
  if (options.promptQueue) {
    const pqProjects = loadPqProjects();
    for (const pq of pqProjects) {
      try {
        const action = decidePqAction(pq, queuedCount, options.limit, options.queue, now);

        if (action.type === "notify" && !options.notify) {
          actions.push({ type: "skip", project: pq.name, reason: "active" });
          continue;
        }

        actions.push(action);
        if (action.type === "queue-step-pq") queuedCount++;
      } catch (e: unknown) {
        const msg = e instanceof Error ? e.message : String(e);
        actions.push({ type: "error", project: pq.name, error: msg });
      }
    }

    // Stale queue cleanup
    const queueEntries = parseQueueList();
    const cleanupActions = findStaleEntries(queueEntries, now);
    actions.push(...cleanupActions);
  }

  // --- Execute ---
  for (const action of actions) {
    executeAction(action, dryRun);
  }

  // --- Output ---
  const result: SuperviseResult = { ...tally(actions), actions };

  if (json) {
    console.log(JSON.stringify(result, null, 2));
  } else {
    const header = dryRun ? "[DRY RUN] " : "";
    console.log(
      `${header}pipeline supervise \u2014 ${result.projects} projects scanned`,
    );
    console.log();
    for (const action of actions) {
      if (action.type === "cleanup-stale" || action.type === "cleanup-duplicate") continue;
      const line = verbose
        ? formatVerboseAction(action)
        : formatAction(action, dryRun);
      if (line) console.log(line);
    }
    console.log();

    const parts = [
      result.advanced > 0 ? `${result.advanced} advanced` : null,
      result.queued > 0 ? `${result.queued} queued` : null,
      result.archived > 0 ? `${result.archived} archived` : null,
      result.notified > 0 ? `${result.notified} notified` : null,
      result.skippedActive > 0 ? `${result.skippedActive} skipped` : null,
      result.skippedLimit > 0 ? `${result.skippedLimit} skipped (limit)` : null,
      result.errors.length > 0 ? `${result.errors.length} errors` : null,
    ].filter(Boolean);
    console.log(`Summary: ${parts.join(", ") || "nothing to do"}`);

    if (result.staleRemoved > 0 || result.duplicateRemoved > 0) {
      console.log(
        `Queue cleanup: removed ${result.staleRemoved} stale, ${result.duplicateRemoved} duplicate entries`,
      );
    }

    if (dryRun) {
      console.log("\n[DRY RUN] No actions taken.");
    }
  }

  return result;
}
