import { join } from "node:path";
import { homedir } from "node:os";

export function getPipelineDir(): string {
  return join(homedir(), "mesh-vibe", "pipeline");
}

export function getActiveDir(): string {
  return join(getPipelineDir(), "active");
}

export function getArchiveDir(): string {
  return join(getPipelineDir(), "archive");
}

export function getProjectDir(name: string): string {
  return join(getActiveDir(), name);
}

export function getArchivedProjectDir(name: string): string {
  return join(getArchiveDir(), name);
}

export function getProjectFile(name: string): string {
  return join(getProjectDir(name), "project.md");
}

export function getArchivedProjectFile(name: string): string {
  return join(getArchivedProjectDir(name), "project.md");
}

export function getTemplateFile(): string {
  return join(getPipelineDir(), "project-template.md");
}

export function getDataDir(): string {
  return join(homedir(), "mesh-vibe", "data");
}

export function getResearchBotDir(): string {
  return join(getDataDir(), "research-bot");
}

export function getPromptQueueProjectsDir(): string {
  return join(getDataDir(), "prompt-queue", "projects");
}
