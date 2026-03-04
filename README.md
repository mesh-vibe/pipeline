# pipeline

Autonomous SDLC pipeline for mesh-vibe projects. Moves work through structured phases with defined gates, auto-advancement, and cancellation support.

## Quick Start

```bash
# Initialize the pipeline
pipeline init

# Create your first project
pipeline create my-project "Build a thing"

# Check what's happening
pipeline status
```

## How It Works

```
┌──────────────────────────────────────────────────────────────────────────┐
│                           PIPELINE FLOW                                  │
│                                                                          │
│  ┌────────┐   ┌────────┐   ┌───────────┐   ┌────────┐   ┌───────────┐  │
│  │ DESIGN │──▶│ REVIEW │──▶│ IMPLEMENT │──▶│  TEST  │──▶│  FINAL    │  │
│  │        │   │(strict)│   │           │   │        │   │  REVIEW   │  │
│  │research│   │use case│   │ code +    │   │smoke + │   │           │  │
│  │+ design│   │cli spec│   │unit tests │   │e2e +   │   │ complete- │  │
│  │doc     │   │criteria│   │standards  │   │browser │   │ ness seal │  │
│  └────────┘   └───┬────┘   └─────┬─────┘   └───┬────┘   └─────┬─────┘  │
│                   │              ▲              │              │         │
│              ┌────┴────┐        │         ┌────┴────┐         ▼         │
│              │ OWNER   │        └─────────│ DEFECTS │     ARCHIVE       │
│              │SIGN-OFF │                  │ cycle   │                   │
│              │required │                  └─────────┘                   │
│              └─────────┘                                                │
│                                                                          │
│  Workers can leave feedback in discussion.md at any phase              │
│  Exit at any phase: pipeline cancel <name> "reason"                     │
│  Completed projects: ──▶ ~/mesh-vibe/pipeline/archive/                  │
└──────────────────────────────────────────────────────────────────────────┘
```

## Project Directory

```
~/mesh-vibe/pipeline/active/<project-name>/
├── project.md              ◀── pipeline state + gates
├── design.md               ◀── design phase output
├── use-cases.md            ◀── review phase: scenarios
├── cli-spec.md             ◀── review phase: CLI docs
├── acceptance-criteria.md  ◀── review phase: test criteria
├── review-notes.md         ◀── review feedback
├── discussion.md           ◀── threaded discussion log
├── implementation/         ◀── build logs, code references
├── test-results/           ◀── test output, screenshots
├── defects/                ◀── bug reports
└── final-review.md         ◀── completeness report
```

## Gate System

```
DESIGN gates            REVIEW gates            IMPLEMENT gates         TEST gates            FINAL REVIEW gates
─────────────           ────────────            ───────────────         ──────────            ──────────────────
[ ] Design doc          [ ] use-cases.md        [ ] Builds clean        (varies by type)      [ ] All artifacts present
[ ] Questions resolved  [ ] cli-spec.md         [ ] Tests passing       [ ] Starts/runs       [ ] Criteria→results mapped
[ ] Approach decided    [ ] acceptance-criteria  [ ] Coverage met        [ ] Smoke test         [ ] No orphans/TODOs
                        [ ] No ambiguity        [ ] Standards pass      [ ] Integration test   [ ] final-review.md written
                        [ ] Coverage target set                         [ ] UI/CLI verified
                        [ ] Owner sign-off
                             │
                             ▼
                        HUMAN GATE
                        (only here)
```

## Command Reference

```bash
# Setup
pipeline init                              # Create directories, install skill
pipeline init --migrate                    # Also migrate existing design docs
pipeline init --migrate --dry-run          # Preview migration

# Project lifecycle
pipeline create <name> "<description>"     # Create new project in design phase
  --type <type>                            # cli | service | library | heartbeat-task (default: cli)
  --priority <n>                           # 1-5, 1=highest (default: 3)

pipeline status                            # Show all active projects grouped by phase
pipeline status <name>                     # Detailed status for one project
pipeline list                              # Compact active project listing
pipeline list --archive                    # List archived projects

# Phase management
pipeline approve <name>                    # Sign off review → implement
pipeline advance <name>                    # Manually advance to next phase
pipeline send-back <name> "<reason>"       # Send back to previous phase

# Bug intake
pipeline bug <name> "<description>"        # File defect against existing project
  --severity <level>                       # low | medium | high | critical (default: medium)
pipeline bug --new "<description>"         # Create standalone bugfix project

# Other
pipeline cancel <name> "<reason>"          # Cancel and archive a project
pipeline archive <name>                    # Manually archive completed project
pipeline open <name> [artifact]            # Open project dir or specific file
pipeline template [--type <type>]          # Print project template

# Convenience
pipeline idea "<description>"              # Quick-create from one-liner
pipeline ideas                             # List design-phase projects

# All commands support:
  --json                                   # JSON output
  --help                                   # Command help
  --version                                # Show version
```

## FAQ

- **How do I see what's in the pipeline?** → `pipeline status`
- **How do I approve a project?** → `pipeline approve <name>`
- **How do I file a bug?** → `pipeline bug <name> "description"`
- **How do I kill a project?** → `pipeline cancel <name> "reason"`
- **Where are my project files?** → `~/mesh-vibe/pipeline/active/<name>/`
- **Where do completed projects go?** → `~/mesh-vibe/pipeline/archive/<name>/`
- **What if a project is stuck?** → Supervisor auto-detects and queues work or notifies you

## License

MIT
