import { readFileSync } from "node:fs";
import { fail } from "./lib/command.mjs";

const args = process.argv.slice(2);
const fileIndex = args.indexOf("--file");
const message = fileIndex >= 0
  ? readFileSync(args[fileIndex + 1], "utf8").trim()
  : args.filter((argument) => argument !== "--file").join(" ").trim();

if (!message) {
  fail("a commit message or --file path is required");
}

const subject = message.split("\n", 1)[0];
const pattern = /^(feat|fix|docs|style|refactor|perf|test|build|ci|chore|revert)(\([a-z0-9-]+\))?!?: [a-z0-9][\x20-\x7E]*$/;

if (!pattern.test(subject)) {
  fail("use an English Conventional Commit subject such as 'feat: add version history' or 'fix(release): handle empty notes'");
}

if (subject.length > 72) {
  fail(`commit subjects must be at most 72 characters (received ${subject.length})`);
}

if (subject.endsWith(".")) {
  fail("commit subjects must not end with a period");
}

const portugueseVerbs = /:\s+(adiciona|ajusta|atualiza|configura|corrige|cria|documenta|implementa|integra|melhora|prepara)\b/i;

if (portugueseVerbs.test(subject)) {
  fail("commit subjects must be written in English");
}

console.log(`Commit message policy passed: ${subject}`);
