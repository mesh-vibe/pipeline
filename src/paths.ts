import { join } from "node:path";
import { homedir } from "node:os";
import { existsSync, readdirSync, readFileSync } from "node:fs";

export function getPipelineDir(): string {
  return join(homedir(), "mesh-vibe", "vibe-flow");
}

export function getSpecDir(): string {
  return join(getPipelineDir(), "specs");
}

export function getSpecFlowDir(flowName: string): string {
  return join(getSpecDir(), flowName);
}

export function getFlowsDir(): string {
  return join(getPipelineDir(), "flows");
}

export function getFlowDir(flowName: string): string {
  return join(getFlowsDir(), flowName);
}

export function getFlowActiveDir(flowName: string): string {
  return join(getFlowDir(flowName), "active");
}

export function getFlowArchiveDir(flowName: string): string {
  return join(getFlowDir(flowName), "archive");
}

// --- Legacy flat-path functions (used when flow is known) ---

export function getActiveDir(): string {
  // Legacy: returns the default flow's active dir
  // Used internally when we already know the flow
  return join(getFlowsDir(), "point-release", "active");
}

export function getArchiveDir(): string {
  // Legacy: returns the default flow's archive dir
  return join(getFlowsDir(), "point-release", "archive");
}

// --- Flow-aware project path lookup ---

function parseFlowFromProjectFile(projectFilePath: string): string {
  try {
    const content = readFileSync(projectFilePath, "utf-8");
    const match = content.match(/^flow:\s*(.+)$/m);
    return match ? match[1].trim() : "point-release";
  } catch {
    return "point-release";
  }
}

/**
 * Find a project by name across all flow directories.
 * Returns the project directory path, or null if not found.
 */
export function findProjectDir(name: string): string | null {
  const flowsDir = getFlowsDir();
  if (!existsSync(flowsDir)) return null;
  const flows = readdirSync(flowsDir, { withFileTypes: true });
  for (const flow of flows) {
    if (!flow.isDirectory()) continue;
    const projectDir = join(flowsDir, flow.name, "active", name);
    if (existsSync(projectDir)) return projectDir;
  }
  return null;
}

/**
 * Find an archived project by name across all flow directories.
 * Returns the project directory path, or null if not found.
 */
export function findArchivedProjectDir(name: string): string | null {
  const flowsDir = getFlowsDir();
  if (!existsSync(flowsDir)) return null;
  const flows = readdirSync(flowsDir, { withFileTypes: true });
  for (const flow of flows) {
    if (!flow.isDirectory()) continue;
    const projectDir = join(flowsDir, flow.name, "archive", name);
    if (existsSync(projectDir)) return projectDir;
  }
  return null;
}

export function getProjectDir(name: string): string {
  // Search across all flows for an existing project
  const found = findProjectDir(name);
  if (found) return found;
  // Fallback to default flow for new projects (caller will set the right dir)
  return join(getFlowsDir(), "point-release", "active", name);
}

export function getArchivedProjectDir(name: string): string {
  // Search across all flows for an existing archived project
  const found = findArchivedProjectDir(name);
  if (found) return found;
  // Fallback to default flow
  return join(getFlowsDir(), "point-release", "archive", name);
}

export function getProjectFile(name: string): string {
  return join(getProjectDir(name), "project.md");
}

export function getArchivedProjectFile(name: string): string {
  return join(getArchivedProjectDir(name), "project.md");
}

/**
 * Get the project dir for a project under a specific flow.
 * Used when creating new projects where we know the target flow.
 */
export function getFlowProjectDir(flowName: string, name: string): string {
  return join(getFlowActiveDir(flowName), name);
}

/**
 * Get the archived project dir for a project under a specific flow.
 */
export function getFlowArchivedProjectDir(flowName: string, name: string): string {
  return join(getFlowArchiveDir(flowName), name);
}

export function getPromptQueueProjectsDir(): string {
  return join(homedir(), "mesh-vibe", "prompt-queue", "projects");
}
