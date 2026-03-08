export const RESEARCH_YAML = `name: research
description: Research and discovery — explore a topic, produce findings, approve
default: false

phases:
  - name: research
    worker: research-bot
    gates:
      - name: topic-defined
        label: Research topic and scope defined
      - name: findings-complete
        label: Findings document complete
        verify: file-exists findings.md
        artifacts: [findings.md]
      - name: recommendation-made
        label: Recommendation made (next steps or standalone deliverable)

  - name: approve
    human-gate: true
    gates:
      - name: findings-reviewed
        label: Findings reviewed by owner
      - name: owner-sign-off
        label: Owner sign-off

  - name: archive
    terminal: true
    auto-archive: true
    gates:
      - name: deliverable-complete
        label: Final deliverable produced or follow-on project created

features:
  discussion-log: true
  defect-cycle: false
  bug-intake: false
  cancellation: true
`;
