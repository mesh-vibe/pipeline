import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { homedir } from "node:os";

const SKILL_CONTENT = `---
name: pipeline
description: Manage the mesh-vibe SDLC pipeline — create projects, check status, approve, file bugs, cancel, and more.
---

# Pipeline Skill

Manage the autonomous SDLC pipeline for mesh-vibe projects.

## Triggers

"pipeline", "create project", "file a bug", "approve project", "check pipeline status", "cancel project", "pipeline status", "what's in the pipeline"

## Commands

\`\`\`bash
# View pipeline
pipeline status              # All active projects with phase and gate progress
pipeline status <name>       # Detailed status for one project
pipeline list                # Compact listing
pipeline list --archive      # Archived projects

# Project lifecycle
pipeline create <name> "<description>" [--type cli|service|library|heartbeat-task] [--priority 1-5]
pipeline approve <name>      # Sign off review → implement
pipeline advance <name>      # Manually advance phase
pipeline send-back <name> "<reason>"  # Send back to previous phase

# Bugs
pipeline bug <name> "<description>" [--severity low|medium|high|critical]
pipeline bug --new "<description>"   # Standalone bugfix project

# Other
pipeline cancel <name> "<reason>"
pipeline archive <name>
pipeline open <name> [artifact]
pipeline template [--type <type>]
\`\`\`

## Natural Language Mapping

- "Create a new project for X" → \`pipeline create <name> "<description>"\`
- "Approve X for implementation" → \`pipeline approve <name>\`
- "File a bug against X" → \`pipeline bug <name> "<description>"\`
- "What's in the pipeline?" → \`pipeline status\`
- "Cancel X" → \`pipeline cancel <name> "<reason>"\`
- "Send X back to design" → \`pipeline send-back <name> "<reason>"\`

## Data Location

- Active projects: ~/mesh-vibe/data/vibe-flow/active/
- Archived projects: ~/mesh-vibe/data/vibe-flow/archive/
- Flow specs: ~/mesh-vibe/data/vibe-flow-spec/
- Each project has: project.md, design.md, use-cases.md, cli-spec.md, acceptance-criteria.md, review-notes.md, discussion.md, defects/, test-results/, final-review.md

## Phase Flow

design → review → implement → test → final-review → archive

The review → implement transition requires owner sign-off via \`pipeline approve\`.
`;

export function installSkill(): void {
  const skillDir = join(homedir(), ".claude", "skills", "pipeline");
  mkdirSync(skillDir, { recursive: true });
  writeFileSync(join(skillDir, "SKILL.md"), SKILL_CONTENT, "utf-8");
}
