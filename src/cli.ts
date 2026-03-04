#!/usr/bin/env node

import { Command } from "commander";

const program = new Command();

program
  .name("pipeline")
  .description("Autonomous SDLC pipeline for mesh-vibe projects")
  .version("0.1.0");

program
  .command("init")
  .description("Bootstrap pipeline directories and templates")
  .option("--migrate", "Move existing design docs and projects into pipeline structure")
  .option("--dry-run", "Show what --migrate would do without doing it")
  .action((_opts) => {
    console.log("TODO: implement init");
  });

program
  .command("create")
  .description("Create a new project in design phase")
  .argument("<name>", "kebab-case project name")
  .argument("<description>", "One-line project description")
  .option("--type <type>", "Project type: service, cli, library, heartbeat-task", "cli")
  .option("--priority <n>", "Priority 1-5, 1=highest", "3")
  .action((_name, _description, _opts) => {
    console.log("TODO: implement create");
  });

program
  .command("status")
  .description("Show pipeline status (all or one project)")
  .argument("[name]", "Project name for detailed status")
  .option("--json", "Output in JSON format")
  .action((_name, _opts) => {
    console.log("TODO: implement status");
  });

program
  .command("list")
  .description("List projects (compact)")
  .option("--archive", "Show archived projects instead of active")
  .option("--json", "Output in JSON format")
  .action((_opts) => {
    console.log("TODO: implement list");
  });

program
  .command("approve")
  .description("Sign off on review → implement transition")
  .argument("<name>", "Project name")
  .action((_name) => {
    console.log("TODO: implement approve");
  });

program
  .command("advance")
  .description("Manually advance to next phase")
  .argument("<name>", "Project name")
  .action((_name) => {
    console.log("TODO: implement advance");
  });

program
  .command("send-back")
  .description("Send project back to previous phase")
  .argument("<name>", "Project name")
  .argument("<reason>", "Reason for sending back")
  .action((_name, _reason) => {
    console.log("TODO: implement send-back");
  });

program
  .command("bug")
  .description("File a defect against a project")
  .argument("[name]", "Project name (omit with --new)")
  .argument("[description]", "Defect description")
  .option("--new", "Create standalone bugfix project")
  .option("--severity <level>", "low, medium, high, critical", "medium")
  .action((_name, _description, _opts) => {
    console.log("TODO: implement bug");
  });

program
  .command("cancel")
  .description("Cancel a project")
  .argument("<name>", "Project name")
  .argument("<reason>", "Reason for cancellation")
  .action((_name, _reason) => {
    console.log("TODO: implement cancel");
  });

program
  .command("open")
  .description("Open project files")
  .argument("<name>", "Project name")
  .argument("[artifact]", "Specific artifact: design, use-cases, cli-spec, acceptance, review-notes, defects, test-results, project")
  .action((_name, _artifact) => {
    console.log("TODO: implement open");
  });

program
  .command("archive")
  .description("Manually archive a completed project")
  .argument("<name>", "Project name")
  .option("--force", "Archive even with open defects")
  .action((_name, _opts) => {
    console.log("TODO: implement archive");
  });

program
  .command("template")
  .description("Print default project template")
  .option("--type <type>", "Show template for specific type", "cli")
  .action((_opts) => {
    console.log("TODO: implement template");
  });

program
  .command("idea")
  .description("Create a new project in design phase from a one-liner")
  .argument("<description...>", "Idea description")
  .action((_description) => {
    console.log("TODO: implement idea");
  });

program
  .command("ideas")
  .description("List all projects in design phase")
  .action(() => {
    console.log("TODO: implement ideas");
  });

program.parse();
