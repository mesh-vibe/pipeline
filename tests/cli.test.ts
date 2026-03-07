import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { execSync } from "node:child_process";
import { existsSync, mkdirSync, rmSync } from "node:fs";
import { join } from "node:path";
import { homedir } from "node:os";

const PIPELINE_DIR = join(homedir(), "mesh-vibe", "data", "vibe-flow");
const ACTIVE_DIR = join(PIPELINE_DIR, "active");
const ARCHIVE_DIR = join(PIPELINE_DIR, "archive");
const TEST_PROJECT = "cli-test-project";

function run(cmd: string): string {
  return execSync(cmd, { encoding: "utf-8", timeout: 10000 }).trim();
}

function cleanup() {
  const activeDir = join(ACTIVE_DIR, TEST_PROJECT);
  const archiveDir = join(ARCHIVE_DIR, TEST_PROJECT);
  if (existsSync(activeDir)) rmSync(activeDir, { recursive: true });
  if (existsSync(archiveDir)) rmSync(archiveDir, { recursive: true });
}

describe("CLI integration", () => {
  beforeEach(() => {
    cleanup();
    // Ensure pipeline is initialized
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
});
