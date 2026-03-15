export type Phase = string;

export type ProjectType = string;

export const VALID_TYPES: string[] = ["cli", "service", "library", "heartbeat-task"];

export const PHASES: string[] = ["design", "review", "implement", "test", "final-review"];

export interface Gate {
  label: string;
  checked: boolean;
}

export interface GateSection {
  name: string;
  gates: Gate[];
}

export interface ProjectFrontmatter {
  name: string;
  description: string;
  flow: string;
  "flow-version": number;
  "project-type": string;
  phase: string;
  priority: number;
  created: string;
  updated: string;
  "approved-at": string;
  "stuck-threshold-minutes": number;
  cancelled: boolean;
  "cancelled-reason": string;
  "cancelled-at": string;
  "cancelled-from": string;
  "needs-interactive": boolean;
  "needs-interactive-reason": string;
}

export interface ParsedProject {
  frontmatter: ProjectFrontmatter;
  rawContent: string;
  filePath: string;
}
