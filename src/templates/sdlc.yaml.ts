export const SDLC_YAML = `name: sdlc-point-release-v1-0
description: Software development lifecycle — design, review, implement, test, final review
default: true

phases:
  - name: design
    worker: research-bot
    gates:
      - name: design-doc-complete
        label: Design doc complete
        verify: file-exists design.md
        artifacts: [design.md]
      - name: open-questions-resolved
        label: Open questions resolved
      - name: approach-decided
        label: Approach decided

  - name: review
    human-gate: true
    gates:
      - name: use-cases-produced
        label: use-cases.md produced (happy path, edge cases, error scenarios)
        verify: file-exists use-cases.md
        artifacts: [use-cases.md]
      - name: cli-spec-produced
        label: cli-spec.md produced (commands, flags, output, examples)
        verify: file-exists cli-spec.md
        artifacts: [cli-spec.md]
      - name: acceptance-criteria-produced
        label: acceptance-criteria.md produced (testable Given/When/Then statements)
        verify: file-exists acceptance-criteria.md
        artifacts: [acceptance-criteria.md]
      - name: no-ambiguity
        label: No ambiguity remaining in design
      - name: coverage-target
        label: Test coverage target specified
      - name: owner-sign-off
        label: Owner sign-off

  - name: implement
    entry-point: true
    gates:
      - name: builds-clean
        label: Builds clean
      - name: tests-passing
        label: Tests passing
      - name: coverage-target-met
        label: Coverage target met
      - name: standards-bot-passes
        label: Standards-bot passes (~/IdeaProjects/mesh-vibe/mesh-vibe/README.md)
    gate-variants:
      by: project-type

  - name: test
    skip-if: project-type == docs
    gates:
      - name: tests-pass
        label: Tests pass
    gate-variants:
      by: project-type
      cli:
        - name: cli-starts
          label: CLI starts and shows help
        - name: smoke-test
          label: Smoke test passed (core commands)
        - name: integration-test
          label: Integration test passed
        - name: acceptance-verified
          label: All acceptance criteria verified
      service:
        - name: service-starts
          label: Service starts cleanly on expected port
        - name: smoke-test
          label: Smoke test passed (health endpoint)
        - name: integration-test
          label: Integration test passed
        - name: ui-verified
          label: UI verified (if applicable)
      library:
        - name: unit-tests
          label: Unit tests pass
        - name: integration-tests
          label: Integration tests pass
        - name: npm-pack
          label: npm pack succeeds
      heartbeat-task:
        - name: task-runs
          label: Task runs without error
        - name: output-format
          label: Output matches expected format
        - name: timeout-respected
          label: Timeout is respected

  - name: final-review
    terminal: true
    gates:
      - name: artifacts-present
        label: All artifacts present and consistent
      - name: acceptance-mapped
        label: Acceptance criteria mapped to test results
      - name: no-orphaned
        label: No orphaned files or TODOs
      - name: final-review-written
        label: final-review.md written
        verify: file-exists final-review.md
        artifacts: [final-review.md]

features:
  discussion-log: true
  defect-cycle: true
  bug-intake: true
  cancellation: true

workers:
  research-bot:
    prompt: workers/research-bot.md
`;
