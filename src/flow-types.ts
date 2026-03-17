export interface FlowTemplate {
  name: string;
  description: string;
  default: boolean;
  phases: FlowPhase[];
  features: FlowFeatures;
  workers: Record<string, WorkerConfig>;
}

export interface FlowPhase {
  name: string;
  worker?: string;
  entryPoint: boolean;
  terminal: boolean;
  autoArchive: boolean;
  humanGate: boolean;
  skipIf?: string;
  gates: FlowGate[];
  gateVariants?: GateVariants;
}

export interface FlowGate {
  name: string;
  label: string;
  type?: "checkbox" | "yes-no" | "text";
  description?: string;
  prompt?: string;
  verify?: string;
  artifacts?: string[];
  onNo?: "cancel" | "shelve";
}

export interface GateVariants {
  by: string;
  [key: string]: FlowGate[] | string;
}

export interface FlowFeatures {
  discussionLog: boolean;
  defectCycle: boolean;
  bugIntake: boolean;
  cancellation: boolean;
}

export interface WorkerConfig {
  prompt: string;
}

export interface ValidationError {
  message: string;
  phase?: string;
  gate?: string;
}

export interface ValidationResult {
  valid: boolean;
  errors: ValidationError[];
  warnings: ValidationError[];
  phaseCount: number;
  gateCount: number;
}
