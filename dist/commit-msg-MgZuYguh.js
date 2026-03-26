#!/usr/bin/env node
import { n as DEFAULT_COMMIT_TYPES, t as loadConfig } from "./loader-COlyl5x_.js";
import { readFile } from "node:fs/promises";
//#region src/commit/validator.ts
const HEADER_PATTERN = /^(?<type>\w+)(?:\((?<scope>[^)]+)\))?(?<breaking>!)?:\s(?<subject>.+)$/;
const CASE_PATTERNS = new Map([
	["start-case", /^[A-Z][a-z]+(?:\s[A-Z][a-z]+)*$/],
	["pascal-case", /^[A-Z][a-zA-Z0-9]+$/],
	["upper-case", /^[A-Z\s]+$/]
]);
function parseHeader(header) {
	const match = header.match(HEADER_PATTERN);
	if (!match?.groups) return null;
	return {
		type: match.groups["type"] ?? "",
		scope: match.groups["scope"],
		breaking: match.groups["breaking"] === "!",
		subject: match.groups["subject"] ?? "",
		body: void 0
	};
}
/**
* Validate a commit message against the configured rules.
* Returns structured validation result with all issues found.
*/
function validateCommitMessage(message, config) {
	const issues = [];
	const lines = message.split("\n");
	const header = lines[0] ?? "";
	const parsed = parseHeader(header);
	if (!parsed) {
		issues.push({
			severity: "error",
			field: "format",
			message: "must be \"type(scope): subject\" or \"type: subject\""
		});
		return {
			valid: false,
			issues,
			parsed: null
		};
	}
	if (!config.types.includes(parsed.type)) issues.push({
		severity: "error",
		field: "type",
		message: `"${parsed.type}" is not an allowed type (${config.types.join(", ")})`
	});
	if (parsed.scope && config.scopes && !config.scopes.includes(parsed.scope)) issues.push({
		severity: "warning",
		field: "scope",
		message: `"${parsed.scope}" is not an allowed scope (${config.scopes.join(", ")})`
	});
	for (const [caseName, pattern] of CASE_PATTERNS) if (pattern.test(parsed.subject)) {
		issues.push({
			severity: "error",
			field: "subject-case",
			message: `subject must not be ${caseName}`
		});
		break;
	}
	if (header.length > config.header_max_length) issues.push({
		severity: "error",
		field: "header-max-length",
		message: `header is ${header.length} characters, maximum is ${config.header_max_length}`
	});
	const bodyStart = lines.indexOf("", 1);
	if (bodyStart !== -1) for (let i = bodyStart + 1; i < lines.length; i++) {
		const line = lines[i];
		if (line && line.length > config.body_max_line_length) {
			issues.push({
				severity: "warning",
				field: "body-max-line-length",
				message: `body line ${i + 1} is ${line.length} characters, maximum is ${config.body_max_line_length}`
			});
			break;
		}
	}
	const hasErrors = issues.some((i) => i.severity === "error");
	const body = bodyStart !== -1 ? lines.slice(bodyStart + 1).join("\n").trim() : void 0;
	const fullParsed = {
		...parsed,
		body: body || void 0
	};
	return {
		valid: !hasErrors,
		issues,
		parsed: fullParsed
	};
}
//#endregion
//#region src/commands/commit-msg.ts
const RESET = "\x1B[0m";
const BOLD = "\x1B[1m";
const DIM = "\x1B[2m";
const RED = "\x1B[31m";
const YELLOW = "\x1B[33m";
const FAIL = `${RED}✗${RESET}`;
const WARN = `${YELLOW}⚠${RESET}`;
/** Default config used when no mido.yml commits section exists */
const FALLBACK_CONFIG = {
	types: [...DEFAULT_COMMIT_TYPES],
	header_max_length: 100,
	body_max_line_length: 200
};
/**
* Validate a commit message file against conventional commit rules.
*
* @returns exit code (0 = valid, 1 = invalid)
*/
async function runCommitMsg(filePath) {
	const message = (await readFile(filePath, "utf-8")).trim();
	if (!message) {
		console.error(`${FAIL} commit message is empty`);
		return 1;
	}
	let commitsConfig;
	try {
		const { config } = await loadConfig();
		commitsConfig = config.commits ?? FALLBACK_CONFIG;
	} catch {
		commitsConfig = FALLBACK_CONFIG;
	}
	const result = validateCommitMessage(message, commitsConfig);
	if (result.valid && result.issues.length === 0) return 0;
	if (result.valid) {
		for (const issue of result.issues) console.error(`${WARN} ${YELLOW}${issue.field}:${RESET} ${issue.message}`);
		return 0;
	}
	const header = message.split("\n")[0] ?? "";
	console.error(`\n${FAIL} ${BOLD}commit message invalid${RESET}\n`);
	console.error(`  header: ${DIM}"${header}"${RESET}`);
	for (const issue of result.issues) {
		const icon = issue.severity === "error" ? FAIL : WARN;
		console.error(`  ${icon} ${issue.field}: ${issue.message}`);
	}
	console.error("");
	console.error(`  ${DIM}Use: feat: add new feature${RESET}`);
	console.error(`  ${DIM}     fix(server): resolve auth timeout${RESET}`);
	console.error("");
	return 1;
}
//#endregion
export { runCommitMsg };

//# sourceMappingURL=commit-msg-MgZuYguh.js.map