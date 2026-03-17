import { readFileSync, writeFileSync, existsSync, readdirSync, cpSync, unlinkSync } from "node:fs";
import { join, basename } from "node:path";
import { execSync } from "node:child_process";
import yaml from "js-yaml";
import type {
  FlowTemplate,
  FlowPhase,
  FlowGate,
  GateVariants,
  FlowFeatures,
  WorkerConfig,
  ValidationError,
  ValidationResult,
} from "./flow-types.js";
import { getSpecDir } from "./paths.js";
import { listActiveProjects } from "./project.js";

// --- YAML Parsing ---

function parsePhase(raw: Record<string, unknown>): FlowPhase {
  const gates: FlowGate[] = [];
  const rawGates = raw["gates"] as Record<string, unknown>[] | undefined;
  if (Array.isArray(rawGates)) {
    for (const g of rawGates) {
      const rawType = g["type"] ? String(g["type"]) : undefined;
      const gateType = rawType === "yes-no" || rawType === "text" ? rawType : undefined;
      const rawOnNo = g["on-no"] ? String(g["on-no"]) : undefined;
      const onNo = rawOnNo === "cancel" || rawOnNo === "shelve" ? rawOnNo : undefined;
      gates.push({
        name: String(g["name"] || ""),
        label: String(g["label"] || ""),
        type: gateType,
        description: g["description"] ? String(g["description"]) : undefined,
        prompt: g["prompt"] ? String(g["prompt"]) : undefined,
        verify: g["verify"] ? String(g["verify"]) : undefined,
        artifacts: Array.isArray(g["artifacts"])
          ? g["artifacts"].map(String)
          : undefined,
        onNo,
      });
    }
  }

  let gateVariants: GateVariants | undefined;
  const rawVariants = raw["gate-variants"] as Record<string, unknown> | undefined;
  if (rawVariants && typeof rawVariants === "object") {
    gateVariants = { by: String(rawVariants["by"] || "") };
    for (const [key, val] of Object.entries(rawVariants)) {
      if (key === "by") continue;
      if (Array.isArray(val)) {
        gateVariants[key] = val.map((g: Record<string, unknown>) => {
          const rawType = g["type"] ? String(g["type"]) : undefined;
          const gateType = rawType === "yes-no" || rawType === "text" ? rawType : undefined;
          const rawOnNo = g["on-no"] ? String(g["on-no"]) : undefined;
          const onNo = rawOnNo === "cancel" || rawOnNo === "shelve" ? rawOnNo : undefined;
          return {
            name: String(g["name"] || ""),
            label: String(g["label"] || ""),
            type: gateType,
            description: g["description"] ? String(g["description"]) : undefined,
            prompt: g["prompt"] ? String(g["prompt"]) : undefined,
            verify: g["verify"] ? String(g["verify"]) : undefined,
            artifacts: Array.isArray(g["artifacts"])
              ? g["artifacts"].map(String)
              : undefined,
            onNo,
          };
        });
      }
    }
  }

  return {
    name: String(raw["name"] || ""),
    worker: raw["worker"] ? String(raw["worker"]) : undefined,
    entryPoint: Boolean(raw["entry-point"]),
    terminal: Boolean(raw["terminal"]),
    autoArchive: Boolean(raw["auto-archive"]),
    humanGate: Boolean(raw["human-gate"]),
    skipIf: raw["skip-if"] ? String(raw["skip-if"]) : undefined,
    gates,
    gateVariants,
  };
}

function parseTemplate(raw: Record<string, unknown>): FlowTemplate {
  const phases: FlowPhase[] = [];
  const rawPhases = raw["phases"] as Record<string, unknown>[] | undefined;
  if (Array.isArray(rawPhases)) {
    for (let i = 0; i < rawPhases.length; i++) {
      const phase = parsePhase(rawPhases[i]);
      // First phase is always an entry point
      if (i === 0) phase.entryPoint = true;
      phases.push(phase);
    }
  }

  const rawFeatures = (raw["features"] || {}) as Record<string, unknown>;
  const features: FlowFeatures = {
    discussionLog: rawFeatures["discussion-log"] !== false,
    defectCycle: rawFeatures["defect-cycle"] !== false,
    bugIntake: rawFeatures["bug-intake"] !== false,
    cancellation: rawFeatures["cancellation"] !== false,
  };

  const workers: Record<string, WorkerConfig> = {};
  const rawWorkers = (raw["workers"] || {}) as Record<string, Record<string, unknown>>;
  if (typeof rawWorkers === "object") {
    for (const [name, config] of Object.entries(rawWorkers)) {
      if (config && typeof config === "object") {
        workers[name] = { prompt: String(config["prompt"] || "") };
      }
    }
  }

  return {
    name: String(raw["name"] || ""),
    description: String(raw["description"] || ""),
    default: Boolean(raw["default"]),
    phases,
    features,
    workers,
  };
}

// --- Loading ---

export function loadTemplateFromYaml(yamlContent: string): FlowTemplate {
  const raw = yaml.load(yamlContent) as Record<string, unknown>;
  if (!raw || typeof raw !== "object") {
    throw new Error("Invalid YAML: not an object");
  }
  return parseTemplate(raw);
}

export function loadTemplateFromFile(filePath: string): FlowTemplate {
  const content = readFileSync(filePath, "utf-8");
  return loadTemplateFromYaml(content);
}

export function loadInstalledTemplate(name: string): FlowTemplate | null {
  const specDir = getSpecDir();
  const filePath = join(specDir, `${name}.yaml`);
  if (!existsSync(filePath)) return null;
  return loadTemplateFromFile(filePath);
}

export function loadTemplateForProject(flowName: string): FlowTemplate | null {
  return loadInstalledTemplate(flowName);
}

// --- Validation ---

const VALID_VERIFY_PREFIXES = ["file-exists", "command", "manual"];

function validateVerify(verify: string): boolean {
  if (verify === "manual") return true;
  if (verify.startsWith("file-exists ")) return true;
  if (verify.startsWith("command ")) return true;
  return false;
}

function validateSkipIf(expr: string): boolean {
  if (!expr || expr.trim() === "") return true;
  const match = expr.match(/^(\S+)\s+(==|!=)\s+(\S+)$/);
  return match !== null;
}

export function validateTemplate(template: FlowTemplate): ValidationResult {
  const errors: ValidationError[] = [];
  const warnings: ValidationError[] = [];
  let gateCount = 0;

  // Required top-level fields
  if (!template.name) {
    errors.push({ message: "missing required field: name" });
  }
  if (!template.phases || template.phases.length === 0) {
    errors.push({ message: "template must have at least one phase" });
    return { valid: false, errors, warnings, phaseCount: 0, gateCount: 0 };
  }

  // Check phase names unique
  const phaseNames = new Set<string>();
  for (const phase of template.phases) {
    if (!phase.name) {
      errors.push({ message: "phase missing required field: name" });
      continue;
    }
    if (phaseNames.has(phase.name)) {
      errors.push({ message: `duplicate phase name: ${phase.name}` });
    }
    phaseNames.add(phase.name);

    // Each phase must have at least one gate
    if (!phase.gates || phase.gates.length === 0) {
      errors.push({
        message: "phase must have at least one gate",
        phase: phase.name,
      });
      continue;
    }

    // Check gate names unique within phase
    const gateNames = new Set<string>();
    for (const gate of phase.gates) {
      if (!gate.name) {
        errors.push({
          message: "gate missing required field: name",
          phase: phase.name,
        });
        continue;
      }
      if (!gate.label) {
        errors.push({
          message: `gate "${gate.name}" missing required field: label`,
          phase: phase.name,
          gate: gate.name,
        });
      }
      if (gateNames.has(gate.name)) {
        errors.push({
          message: `duplicate gate name: ${gate.name}`,
          phase: phase.name,
          gate: gate.name,
        });
      }
      gateNames.add(gate.name);
      gateCount++;

      // Validate verify type
      if (gate.verify && !validateVerify(gate.verify)) {
        const verifyType = gate.verify.split(" ")[0];
        errors.push({
          message: `unknown verify type: ${verifyType}`,
          phase: phase.name,
          gate: gate.name,
        });
      }
    }

    // Check variant gates too
    if (phase.gateVariants) {
      for (const [key, val] of Object.entries(phase.gateVariants)) {
        if (key === "by") continue;
        if (Array.isArray(val)) {
          for (const gate of val) {
            gateCount++;
            if (!gate.name) {
              errors.push({
                message: "variant gate missing required field: name",
                phase: phase.name,
              });
            }
            if (!gate.label) {
              errors.push({
                message: `variant gate "${gate.name}" missing required field: label`,
                phase: phase.name,
                gate: gate.name,
              });
            }
          }
        }
      }
    }

    // Validate skip-if
    if (phase.skipIf && !validateSkipIf(phase.skipIf)) {
      errors.push({
        message: `invalid skip-if expression: "${phase.skipIf}"`,
        phase: phase.name,
      });
    }
  }

  // Warn about missing worker prompt files
  for (const [name, config] of Object.entries(template.workers)) {
    if (config.prompt && !existsSync(config.prompt)) {
      warnings.push({
        message: `worker prompt file not found: ${config.prompt}`,
      });
    }
  }

  return {
    valid: errors.length === 0,
    errors,
    warnings,
    phaseCount: template.phases.length,
    gateCount,
  };
}

export function validateTemplateFile(filePath: string): ValidationResult {
  try {
    const template = loadTemplateFromFile(filePath);
    return validateTemplate(template);
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : String(e);
    return {
      valid: false,
      errors: [{ message: `YAML parse error: ${msg}` }],
      warnings: [],
      phaseCount: 0,
      gateCount: 0,
    };
  }
}

// --- Registry Operations ---

export function listInstalledTemplates(): FlowTemplate[] {
  const specDir = getSpecDir();
  if (!existsSync(specDir)) return [];
  const files = readdirSync(specDir).filter((f) => f.endsWith(".yaml"));
  const templates: FlowTemplate[] = [];
  for (const file of files) {
    try {
      const template = loadTemplateFromFile(join(specDir, file));
      templates.push(template);
    } catch {
      // skip invalid files
    }
  }
  return templates;
}

export function getDefaultTemplate(): FlowTemplate | null {
  const templates = listInstalledTemplates();
  return templates.find((t) => t.default) || null;
}

export function installTemplate(sourcePath: string): {
  success: boolean;
  template?: FlowTemplate;
  error?: string;
} {
  const result = validateTemplateFile(sourcePath);
  if (!result.valid) {
    const errorMsg = result.errors.map((e) => e.message).join("; ");
    return { success: false, error: `Validation failed: ${errorMsg}` };
  }

  const template = loadTemplateFromFile(sourcePath);
  const specDir = getSpecDir();
  const destPath = join(specDir, `${template.name}.yaml`);

  if (existsSync(destPath)) {
    return {
      success: false,
      error: `template '${template.name}' already installed`,
    };
  }

  cpSync(sourcePath, destPath);
  return { success: true, template };
}

export function uninstallTemplate(name: string): {
  success: boolean;
  error?: string;
} {
  const specDir = getSpecDir();
  const templatePath = join(specDir, `${name}.yaml`);

  if (!existsSync(templatePath)) {
    return { success: false, error: `Flow template '${name}' not found` };
  }

  // Check for active projects using this template
  const activeProjects = listActiveProjects();
  const dependents = activeProjects.filter(
    (p) => p.frontmatter.flow === name,
  );

  if (dependents.length > 0) {
    const names = dependents.map((p) => p.frontmatter.name).join(", ");
    return {
      success: false,
      error: `Cannot uninstall '${name}' — ${dependents.length} active projects depend on it:\n  ${names}`,
    };
  }

  unlinkSync(templatePath);
  return { success: true };
}

// --- Phase Engine ---

export function nextPhaseFromTemplate(
  phase: string,
  template: FlowTemplate,
): string | null {
  const idx = template.phases.findIndex((p) => p.name === phase);
  if (idx === -1 || idx >= template.phases.length - 1) return null;
  return template.phases[idx + 1].name;
}

export function prevPhaseFromTemplate(
  phase: string,
  template: FlowTemplate,
): string | null {
  const idx = template.phases.findIndex((p) => p.name === phase);
  if (idx <= 0) return null;
  return template.phases[idx - 1].name;
}

export function isEntryPoint(phase: string, template: FlowTemplate): boolean {
  const p = template.phases.find((ph) => ph.name === phase);
  return p ? p.entryPoint : false;
}

export function isTerminal(phase: string, template: FlowTemplate): boolean {
  const p = template.phases.find((ph) => ph.name === phase);
  return p ? p.terminal : false;
}

export function isHumanGate(phase: string, template: FlowTemplate): boolean {
  const p = template.phases.find((ph) => ph.name === phase);
  return p ? p.humanGate : false;
}

export function shouldAutoArchive(
  phase: string,
  template: FlowTemplate,
): boolean {
  const p = template.phases.find((ph) => ph.name === phase);
  return p ? p.autoArchive : false;
}

// --- Skip-If Evaluation ---

export function evaluateSkipIf(
  expression: string,
  frontmatter: Record<string, string>,
): boolean {
  if (!expression || expression.trim() === "") return false;
  const match = expression.match(/^(\S+)\s+(==|!=)\s+(\S+)$/);
  if (!match) return false;
  const [, field, op, value] = match;
  const actual = frontmatter[field] || "";
  if (op === "==") return actual === value;
  if (op === "!=") return actual !== value;
  return false;
}

// --- Gate Resolution ---

export function resolveGates(
  phase: FlowPhase,
  projectType?: string,
): FlowGate[] {
  const gates = [...phase.gates];
  if (phase.gateVariants && projectType) {
    const variantGates = phase.gateVariants[projectType];
    if (Array.isArray(variantGates)) {
      gates.push(...variantGates);
    }
  }
  return gates;
}

export function resolveAllPhaseGates(
  template: FlowTemplate,
  projectType?: string,
): Map<string, FlowGate[]> {
  const result = new Map<string, FlowGate[]>();
  for (const phase of template.phases) {
    result.set(phase.name, resolveGates(phase, projectType));
  }
  return result;
}

// --- Gate Lookup ---

export function getFlowGateByLabel(
  phase: string,
  label: string,
  template: FlowTemplate,
  projectType?: string,
): FlowGate | undefined {
  const p = template.phases.find((ph) => ph.name === phase);
  if (!p) return undefined;
  const gates = resolveGates(p, projectType);
  return gates.find((g) => g.label === label);
}

// --- Verify Gate Checks ---

export function checkVerifyGate(
  verify: string,
  projectDir: string,
): boolean {
  if (verify === "manual") return false;
  if (verify.startsWith("file-exists ")) {
    const filePath = verify.slice("file-exists ".length).trim();
    return existsSync(join(projectDir, filePath));
  }
  if (verify.startsWith("command ")) {
    const cmd = verify.slice("command ".length).trim().replace(/^"(.*)"$/, "$1");
    try {
      execSync(cmd, { cwd: projectDir, stdio: "pipe" });
      return true;
    } catch {
      return false;
    }
  }
  return false;
}

// --- Template Init/Fork ---

export function generateInitTemplate(name: string): string {
  return `name: ${name}
description: TODO — describe this flow

phases:
  - name: open
    gates:
      - name: requirements-defined
        label: Requirements defined

  - name: in-progress
    gates:
      - name: implementation-complete
        label: Implementation complete

  - name: done
    terminal: true
    auto-archive: true
    gates:
      - name: verified
        label: Verified and accepted

features:
  discussion-log: true
  defect-cycle: false
  bug-intake: false
  cancellation: true
`;
}

export function forkTemplate(
  sourceName: string,
  targetName: string,
): { success: boolean; filePath?: string; error?: string } {
  const specDir = getSpecDir();
  const sourcePath = join(specDir, `${sourceName}.yaml`);

  if (!existsSync(sourcePath)) {
    return {
      success: false,
      error: `Flow template '${sourceName}' not found`,
    };
  }

  const targetPath = `${targetName}.yaml`;
  if (existsSync(targetPath)) {
    return {
      success: false,
      error: `File '${targetPath}' already exists`,
    };
  }

  const content = readFileSync(sourcePath, "utf-8");
  const updated = content.replace(/^name:\s+.*$/m, `name: ${targetName}`);
  writeFileSync(targetPath, updated, "utf-8");
  return { success: true, filePath: targetPath };
}

// --- Template Migration ---

export function migrateProject(
  projectDir: string,
  projectFilePath: string,
  currentVersion: number,
  template: FlowTemplate,
): {
  success: boolean;
  changes: string[];
  error?: string;
} {
  // For now, migration compares current project gates with template gates
  // and adds new / marks removed as N/A
  const content = readFileSync(projectFilePath, "utf-8");
  const changes: string[] = [];

  // This is a placeholder for more sophisticated migration logic
  // The actual implementation would diff gate structures between versions
  const latestVersion = currentVersion + 1;
  let updated = content.replace(
    /^(flow-version:).*$/m,
    `$1 ${latestVersion}`,
  );

  if (updated === content) {
    return { success: true, changes: ["Already on latest version"] };
  }

  writeFileSync(projectFilePath, updated, "utf-8");
  changes.push(`Updated flow-version: ${latestVersion}`);

  return { success: true, changes };
}
