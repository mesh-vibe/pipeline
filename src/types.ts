export type Phase = "design" | "review" | "implement" | "test" | "final-review";

export type ProjectType = "cli" | "service" | "library" | "heartbeat-task";

export const VALID_TYPES: ProjectType[] = ["cli", "service", "library", "heartbeat-task"];

export const PHASES: Phase[] = ["design", "review", "implement", "test", "final-review"];

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
  "project-type": ProjectType;
  phase: Phase | "cancelled";
  priority: number;
  created: string;
  updated: string;
  "approved-at": string;
  "stuck-threshold-minutes": number;
  cancelled: boolean;
  "cancelled-reason": string;
  "cancelled-at": string;
  "cancelled-from": string;
}

export interface ParsedProject {
  frontmatter: ProjectFrontmatter;
  rawContent: string;
  filePath: string;
}
