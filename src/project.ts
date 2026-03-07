import {
  readFileSync,
  writeFileSync,
  existsSync,
  readdirSync,
  mkdirSync,
  renameSync,
  cpSync,
} from "node:fs";
import type {
  ProjectFrontmatter,
  Phase,
  Gate,
  GateSection,
  ProjectType,
  ParsedProject,
} from "./types.js";
import { PHASES } from "./types.js";
import {
  getActiveDir,
  getArchiveDir,
  getProjectDir,
  getArchivedProjectDir,
  getProjectFile,
  getArchivedProjectFile,
} from "./paths.js";

// --- Frontmatter Parsing ---

export function parseFrontmatter(content: string): Record<string, string> {
  const match = content.match(/^---\n([\s\S]*?)\n---/);
  if (!match) return {};
  const data: Record<string, string> = {};
  for (const line of match[1].split("\n")) {
    const kv = line.match(/^([\w-]+):\s*(.*)$/);
    if (kv) data[kv[1]] = kv[2].trim();
  }
  return data;
}

function toFrontmatter(fm: Record<string, string>): ProjectFrontmatter {
  return {
    name: fm["name"] || "",
    description: fm["description"] || "",
    flow: fm["flow"] || "sdlc",
    "project-type": (fm["project-type"] || "cli") as ProjectType,
    phase: (fm["phase"] || "design") as Phase | "cancelled",
    priority: parseInt(fm["priority"] || "3", 10),
    created: fm["created"] || "",
    updated: fm["updated"] || "",
    "approved-at": fm["approved-at"] || "",
    "stuck-threshold-minutes": parseInt(
      fm["stuck-threshold-minutes"] || "120",
      10,
    ),
    cancelled: fm["cancelled"] === "true",
    "cancelled-reason": fm["cancelled-reason"] || "",
    "cancelled-at": fm["cancelled-at"] || "",
    "cancelled-from": fm["cancelled-from"] || "",
  };
}

// --- Project Reading ---

export function readProject(name: string): ParsedProject | null {
  const filePath = getProjectFile(name);
  if (!existsSync(filePath)) return null;
  const content = readFileSync(filePath, "utf-8");
  const fm = parseFrontmatter(content);
  return { frontmatter: toFrontmatter(fm), rawContent: content, filePath };
}

export function readArchivedProject(name: string): ParsedProject | null {
  const filePath = getArchivedProjectFile(name);
  if (!existsSync(filePath)) return null;
  const content = readFileSync(filePath, "utf-8");
  const fm = parseFrontmatter(content);
  return { frontmatter: toFrontmatter(fm), rawContent: content, filePath };
}

export function listActiveProjects(): ParsedProject[] {
  const dir = getActiveDir();
  if (!existsSync(dir)) return [];
  const entries = readdirSync(dir, { withFileTypes: true });
  const projects: ParsedProject[] = [];
  for (const entry of entries) {
    if (entry.isDirectory()) {
      const proj = readProject(entry.name);
      if (proj) projects.push(proj);
    }
  }
  return projects.sort(
    (a, b) => a.frontmatter.priority - b.frontmatter.priority,
  );
}

export function listArchivedProjects(): ParsedProject[] {
  const dir = getArchiveDir();
  if (!existsSync(dir)) return [];
  const entries = readdirSync(dir, { withFileTypes: true });
  const projects: ParsedProject[] = [];
  for (const entry of entries) {
    if (entry.isDirectory()) {
      const proj = readArchivedProject(entry.name);
      if (proj) projects.push(proj);
    }
  }
  return projects;
}

// --- Gate Parsing ---

export function parseGates(content: string): GateSection[] {
  const sections: GateSection[] = [];
  const gatesMatch = content.match(/## Gates\n([\s\S]*?)(?=\n## [^G]|$)/);
  if (!gatesMatch) return sections;
  const gatesText = gatesMatch[1];
  let currentSection: GateSection | null = null;
  for (const line of gatesText.split("\n")) {
    const sectionMatch = line.match(/^### (.+)$/);
    if (sectionMatch) {
      currentSection = { name: sectionMatch[1], gates: [] };
      sections.push(currentSection);
      continue;
    }
    const gateMatch = line.match(/^- \[([ x])\] (.+)$/);
    if (gateMatch && currentSection) {
      currentSection.gates.push({
        checked: gateMatch[1] === "x",
        label: gateMatch[2],
      });
    }
  }
  return sections;
}

function phaseToSectionName(phase: string): string {
  if (phase === "final-review") return "Final Review";
  return phase.charAt(0).toUpperCase() + phase.slice(1);
}

export function getPhaseGates(content: string, phase: string): Gate[] {
  const sections = parseGates(content);
  const sectionName = phaseToSectionName(phase);
  const section = sections.find((s) => s.name === sectionName);
  return section?.gates || [];
}

export function countGates(
  content: string,
  phase: string,
): { checked: number; total: number } {
  const gates = getPhaseGates(content, phase);
  return {
    checked: gates.filter((g) => g.checked).length,
    total: gates.length,
  };
}

export function allGatesMet(content: string, phase: string): boolean {
  const { checked, total } = countGates(content, phase);
  return total > 0 && checked === total;
}

// --- Project Mutation ---

export function updateFrontmatterField(
  filePath: string,
  key: string,
  value: string | number | boolean,
): void {
  let content = readFileSync(filePath, "utf-8");
  const fmMatch = content.match(/^(---\n)([\s\S]*?)(\n---)/);
  if (!fmMatch) return;
  let fmText = fmMatch[2];
  const displayValue =
    value === "" || value === null || value === undefined ? "" : ` ${value}`;
  const regex = new RegExp(`^(${key}:).*$`, "m");
  if (regex.test(fmText)) {
    fmText = fmText.replace(regex, `$1${displayValue}`);
  }
  content = content.replace(
    /^---\n[\s\S]*?\n---/,
    `---\n${fmText}\n---`,
  );
  writeFileSync(filePath, content, "utf-8");
}

export function updateProject(
  name: string,
  updates: Record<string, string | number | boolean>,
): void {
  const proj = readProject(name);
  if (!proj) return;
  for (const [key, value] of Object.entries(updates)) {
    updateFrontmatterField(proj.filePath, key, value);
  }
}

export function checkGate(name: string, gateLabel: string): void {
  const proj = readProject(name);
  if (!proj) return;
  const escaped = gateLabel.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const content = proj.rawContent.replace(
    new RegExp(`- \\[ \\] ${escaped}`),
    `- [x] ${gateLabel}`,
  );
  writeFileSync(proj.filePath, content, "utf-8");
}

export function uncheckPhaseGates(name: string, phase: string): void {
  const proj = readProject(name);
  if (!proj) return;
  const sectionName = phaseToSectionName(phase);
  const escaped = sectionName.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const sectionRegex = new RegExp(
    `(### ${escaped}\n)((?:- \\[[ x]\\] .+\n?)*)`,
    "m",
  );
  const match = proj.rawContent.match(sectionRegex);
  if (!match) return;
  const unchecked = match[2].replace(/- \[x\]/g, "- [ ]");
  const newContent = proj.rawContent.replace(sectionRegex, `$1${unchecked}`);
  writeFileSync(proj.filePath, newContent, "utf-8");
}

export function appendPhaseHistory(name: string, entry: string): void {
  const proj = readProject(name);
  if (!proj) return;
  const content = proj.rawContent.replace(
    /(## Phase History\n(?:[\s\S]*?))((?:\n$|$))/,
    `$1- ${entry}\n$2`,
  );
  writeFileSync(proj.filePath, content, "utf-8");
}

// --- Phase Navigation ---

export function nextPhase(phase: Phase): Phase | null {
  const idx = PHASES.indexOf(phase);
  if (idx === -1 || idx >= PHASES.length - 1) return null;
  return PHASES[idx + 1];
}

export function prevPhase(phase: Phase): Phase | null {
  const idx = PHASES.indexOf(phase);
  if (idx <= 0) return null;
  return PHASES[idx - 1];
}

// --- Defects ---

export function listDefects(
  projectDir: string,
): { file: string; status: string; description: string }[] {
  const defectsDir = `${projectDir}/defects`;
  if (!existsSync(defectsDir)) return [];
  const files = readdirSync(defectsDir).filter((f) => f.endsWith(".md"));
  return files.map((file) => {
    const content = readFileSync(`${defectsDir}/${file}`, "utf-8");
    const fm = parseFrontmatter(content);
    return {
      file,
      status: fm["status"] || "open",
      description: fm["description"] || "",
    };
  });
}

// --- File Existence Check ---

export function checkArtifacts(
  projectDir: string,
): { name: string; exists: boolean }[] {
  const artifacts = [
    "project.md",
    "design.md",
    "use-cases.md",
    "cli-spec.md",
    "acceptance-criteria.md",
    "review-notes.md",
    "discussion.md",
    "final-review.md",
  ];
  return artifacts.map((name) => ({
    name,
    exists: existsSync(`${projectDir}/${name}`),
  }));
}

// --- Move Operations ---

export function moveToArchive(name: string): void {
  const src = getProjectDir(name);
  const dest = getArchivedProjectDir(name);
  mkdirSync(getArchiveDir(), { recursive: true });
  renameSync(src, dest);
}

export function moveFromArchive(name: string): void {
  const src = getArchivedProjectDir(name);
  const dest = getProjectDir(name);
  mkdirSync(getActiveDir(), { recursive: true });
  renameSync(src, dest);
}

// --- Utilities ---

export function today(): string {
  return new Date().toISOString().slice(0, 10);
}

export function timestamp(): string {
  const d = new Date();
  return `${d.toISOString().slice(0, 10)} ${d.toTimeString().slice(0, 5)}`;
}

export function timeAgo(dateStr: string): string {
  if (!dateStr) return "";
  const now = Date.now();
  const then = new Date(dateStr).getTime();
  if (isNaN(then)) return "";
  const diff = now - then;
  const minutes = Math.floor(diff / 60000);
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  return `${days}d ago`;
}

export function slugify(text: string): string {
  return text
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "")
    .slice(0, 50);
}

export const NAME_REGEX = /^[a-z][a-z0-9]*(-[a-z0-9]+)*$/;
