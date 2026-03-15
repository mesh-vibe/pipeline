import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { execSync } from "node:child_process";
import { existsSync, mkdirSync, rmSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { homedir } from "node:os";

const PIPELINE_DIR = join(homedir(), "mesh-vibe", "vibe-flow");
const FLOWS_DIR = join(PIPELINE_DIR, "flows");
const DEFAULT_FLOW = "sdlc-point-release-v1-0";
const ACTIVE_DIR = join(FLOWS_DIR, DEFAULT_FLOW, "active");
const ARCHIVE_DIR = join(FLOWS_DIR, DEFAULT_FLOW, "archive");
const TEST_PROJECT = "cli-test-project";

function run(cmd: string): string {
  return execSync(cmd, { encoding: "utf-8", timeout: 10000 }).trim();
}

function cleanup() {
  // Clean from all flow directories
  if (existsSync(FLOWS_DIR)) {
    const flows = existsSync(FLOWS_DIR) ? require("fs").readdirSync(FLOWS_DIR) : [];
    for (const flow of flows) {
      const activeDir = join(FLOWS_DIR, flow, "active", TEST_PROJECT);
      const archiveDir = join(FLOWS_DIR, flow, "archive", TEST_PROJECT);
      if (existsSync(activeDir)) rmSync(activeDir, { recursive: true });
      if (existsSync(archiveDir)) rmSync(archiveDir, { recursive: true });
    }
  }
}

describe("CLI integration", () => {
  beforeEach(() => {
    cleanup();
    // Ensure pipeline is initialized with flow-based directory structure
    if (!existsSync(ACTIVE_DIR)) {
      run("pipeline init");
    }
  });

  afterEach(() => {
    cleanup();
  });

  it("creates a project", () => {
    const output = run(`pipeline create ${TEST_PROJECT} "Test project"`);
    expect(output).toContain(`Created project: ${TEST_PROJECT}`);
    expect(output).toContain("Phase: design");
    expect(existsSync(join(ACTIVE_DIR, TEST_PROJECT, "project.md"))).toBe(true);
    expect(existsSync(join(ACTIVE_DIR, TEST_PROJECT, "discussion.md"))).toBe(true);
  });

  it("rejects duplicate project names", () => {
    run(`pipeline create ${TEST_PROJECT} "Test project"`);
    try {
      run(`pipeline create ${TEST_PROJECT} "Another test"`);
      expect.unreachable("Should have thrown");
    } catch (e: any) {
      expect(e.stderr || e.message).toContain("already exists");
    }
  });

  it("rejects invalid project names", () => {
    try {
      run(`pipeline create "Bad Name" "Test"`);
      expect.unreachable("Should have thrown");
    } catch (e: any) {
      expect(e.status).toBe(2);
    }
  });

  it("shows status for all projects", () => {
    run(`pipeline create ${TEST_PROJECT} "Test project"`);
    const output = run("pipeline status");
    expect(output).toContain(TEST_PROJECT);
    expect(output).toMatch(/DESIGN \(\d+\)/);
  });

  it("shows detailed status for one project", () => {
    run(`pipeline create ${TEST_PROJECT} "Test project"`);
    const output = run(`pipeline status ${TEST_PROJECT}`);
    expect(output).toContain("Phase:       design");
    expect(output).toContain("Design Gates:");
    expect(output).toContain("[ ] Design doc complete");
  });

  it("lists projects", () => {
    run(`pipeline create ${TEST_PROJECT} "Test project"`);
    const output = run("pipeline list");
    expect(output).toContain(TEST_PROJECT);
    expect(output).toContain("design");
  });

  it("advances a project", () => {
    run(`pipeline create ${TEST_PROJECT} "Test project"`);
    const output = run(`pipeline advance ${TEST_PROJECT}`);
    expect(output).toContain("design → review");
    const status = run(`pipeline status ${TEST_PROJECT}`);
    expect(status).toContain("Phase:       review");
  });

  it("sends back a project", () => {
    run(`pipeline create ${TEST_PROJECT} "Test project"`);
    run(`pipeline advance ${TEST_PROJECT}`);
    const output = run(`pipeline send-back ${TEST_PROJECT} "Needs work"`);
    expect(output).toContain("review → design");
    expect(output).toContain("Appended to review-notes.md");
  });

  it("files a bug against a project", () => {
    run(`pipeline create ${TEST_PROJECT} "Test project"`);
    const output = run(`pipeline bug ${TEST_PROJECT} "Something broke" --severity high`);
    expect(output).toContain("Filed defect");
    expect(output).toContain("Severity: high");
    expect(existsSync(join(ACTIVE_DIR, TEST_PROJECT, "defects"))).toBe(true);
  });

  it("cancels a project", () => {
    run(`pipeline create ${TEST_PROJECT} "Test project"`);
    const output = run(`pipeline cancel ${TEST_PROJECT} "Not needed"`);
    expect(output).toContain("Cancelled:");
    expect(output).toContain("Not needed");
    expect(existsSync(join(ARCHIVE_DIR, TEST_PROJECT))).toBe(true);
    expect(existsSync(join(ACTIVE_DIR, TEST_PROJECT))).toBe(false);
  });

  it("lists archived projects", () => {
    run(`pipeline create ${TEST_PROJECT} "Test project"`);
    run(`pipeline cancel ${TEST_PROJECT} "Done"`);
    const output = run("pipeline list --archive");
    expect(output).toContain(TEST_PROJECT);
    expect(output).toContain("cancelled");
  });

  it("outputs JSON for status", () => {
    run(`pipeline create ${TEST_PROJECT} "Test project"`);
    const output = run(`pipeline status ${TEST_PROJECT} --json`);
    const json = JSON.parse(output);
    expect(json.status).toBe("ok");
    expect(json.data.name).toBe(TEST_PROJECT);
    expect(json.data.phase).toBe("design");
  });

  it("prints template", () => {
    const output = run("pipeline template --type library");
    expect(output).toContain("project-type: library");
    expect(output).toContain("npm pack succeeds");
  });

  // --- Needs Interactive CLI Tests ---

  // AC-9: Unblock clears flag and removes context file
  it("unblock clears needs-interactive flag", () => {
    run(`pipeline create ${TEST_PROJECT} "Test project"`);

    // Set needs-interactive manually
    const projectFile = join(ACTIVE_DIR, TEST_PROJECT, "project.md");
    let content = readFileSync(projectFile, "utf-8");
    content = content.replace(
      /^---\n/,
      "---\nneeds-interactive: true\nneeds-interactive-reason: Test reason\n",
    );
    writeFileSync(projectFile, content, "utf-8");
    writeFileSync(
      join(ACTIVE_DIR, TEST_PROJECT, "needs-interactive.md"),
      "# Context",
      "utf-8",
    );

    const output = run(`pipeline unblock ${TEST_PROJECT}`);
    expect(output).toContain(`Unblocked: ${TEST_PROJECT}`);
    expect(output).toContain("needs-interactive cleared");
    expect(output).toContain("needs-interactive.md removed");
    expect(output).toContain("Updated timestamp refreshed");

    // Verify the flag is cleared
    const updated = readFileSync(projectFile, "utf-8");
    expect(updated).toContain("needs-interactive: false");
    expect(
      existsSync(join(ACTIVE_DIR, TEST_PROJECT, "needs-interactive.md")),
    ).toBe(false);
  });

  // AC-10: Unblock is idempotent when not flagged
  it("unblock is idempotent when not flagged", () => {
    run(`pipeline create ${TEST_PROJECT} "Test project"`);
    const output = run(`pipeline unblock ${TEST_PROJECT}`);
    expect(output).toContain("not flagged as needs-interactive");
    expect(output).toContain("No changes made");
  });

  // AC-11: Unblock rejects non-existent project
  it("unblock rejects non-existent project", () => {
    try {
      run("pipeline unblock nonexistent-project");
      expect.unreachable("Should have thrown");
    } catch (e: any) {
      expect(e.stderr || e.message).toContain("not found in active pipeline");
    }
  });

  // AC-12: Unblock rejects archived project
  it("unblock rejects archived project", () => {
    run(`pipeline create ${TEST_PROJECT} "Test project"`);
    run(`pipeline cancel ${TEST_PROJECT} "Done"`);
    try {
      run(`pipeline unblock ${TEST_PROJECT}`);
      expect.unreachable("Should have thrown");
    } catch (e: any) {
      expect(e.stderr || e.message).toContain("archived");
    }
  });

  // AC-7: Status shows needs-interactive state
  it("status shows needs-interactive indicator", () => {
    run(`pipeline create ${TEST_PROJECT} "Test project"`);

    const projectFile = join(ACTIVE_DIR, TEST_PROJECT, "project.md");
    let content = readFileSync(projectFile, "utf-8");
    content = content.replace(
      /^---\n/,
      "---\nneeds-interactive: true\nneeds-interactive-reason: Cannot validate game mechanics\n",
    );
    writeFileSync(projectFile, content, "utf-8");

    const output = run(`pipeline status ${TEST_PROJECT}`);
    expect(output).toContain("NEEDS INTERACTIVE: Cannot validate game mechanics");
    expect(output).toContain(`pipeline unblock ${TEST_PROJECT}`);
  });

  // AC-8: List shows blocked indicator
  it("list shows [!] for needs-interactive projects", () => {
    run(`pipeline create ${TEST_PROJECT} "Test project"`);

    const projectFile = join(ACTIVE_DIR, TEST_PROJECT, "project.md");
    let content = readFileSync(projectFile, "utf-8");
    content = content.replace(
      /^---\n/,
      "---\nneeds-interactive: true\nneeds-interactive-reason: Blocked\n",
    );
    writeFileSync(projectFile, content, "utf-8");

    const output = run(`pipeline list`);
    expect(output).toContain("[!]");
  });
});
