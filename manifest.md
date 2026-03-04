---
name: pipeline
description: Autonomous SDLC pipeline for mesh-vibe projects
cli: pipeline
data_dir: ~/mesh-vibe/pipeline
version: 0.1.0
health_check: pipeline status
depends_on:
  - registry
---

Pipeline moves mesh-vibe projects through a structured SDLC: design, review, implement, test, final-review, and archive. Each phase has gates that must be met before advancing. The review-to-implement transition requires owner sign-off. Defects cycle back through implement and test until resolved.
