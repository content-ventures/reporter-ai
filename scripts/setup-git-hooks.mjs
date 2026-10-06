import { existsSync } from "node:fs";
import { run } from "./lib/command.mjs";

if (!existsSync(".git")) {
  console.log("Git hooks were not configured because this is not a Git checkout.");
  process.exit(0);
}

run("git", ["config", "core.hooksPath", ".githooks"]);
console.log("Reporter IA Git hooks configured from .githooks.");
