import type { CommitsConfig } from '../config/schema.js';

export type IssueSeverity = 'error' | 'warning';

export interface CommitIssue {
  readonly severity: IssueSeverity;
  readonly field: string;
  readonly message: string;
}

export interface CommitValidation {
  readonly valid: boolean;
  readonly issues: readonly CommitIssue[];
  readonly parsed: ParsedCommit | null;
}

export interface ParsedCommit {
  readonly type: string;
  readonly scope: string | undefined;
  readonly breaking: boolean;
  readonly subject: string;
  readonly body: string | undefined;
}

const HEADER_PATTERN = /^(?<type>\w+)(?:\((?<scope>[^)]+)\))?(?<breaking>!)?:\s(?<subject>.+)$/;

const CASE_PATTERNS: ReadonlyMap<string, RegExp> = new Map([
  ['start-case', /^[A-Z][a-z]+(?:\s[A-Z][a-z]+)*$/],
  ['pascal-case', /^[A-Z][a-zA-Z0-9]+$/],
  ['upper-case', /^[A-Z\s]+$/],
]);

function parseHeader(header: string): ParsedCommit | null {
  const match = header.match(HEADER_PATTERN);
  if (!match?.groups) {
    return null;
  }

  return {
    type: match.groups['type'] ?? '',
    scope: match.groups['scope'],
    breaking: match.groups['breaking'] === '!',
    subject: match.groups['subject'] ?? '',
    body: undefined,
  };
}

/**
 * Validate a commit message against the configured rules.
 * Returns structured validation result with all issues found.
 */
export function validateCommitMessage(message: string, config: CommitsConfig): CommitValidation {
  const issues: CommitIssue[] = [];
  const lines = message.split('\n');
  const header = lines[0] ?? '';

  // Parse header
  const parsed = parseHeader(header);

  if (!parsed) {
    issues.push({
      severity: 'error',
      field: 'format',
      message: 'must be "type(scope): subject" or "type: subject"',
    });

    return { valid: false, issues, parsed: null };
  }

  // Validate type
  if (!config.types.includes(parsed.type)) {
    issues.push({
      severity: 'error',
      field: 'type',
      message: `"${parsed.type}" is not an allowed type (${config.types.join(', ')})`,
    });
  }

  // Validate scope (warning severity — matches commitlint severity 1)
  if (parsed.scope && config.scopes && !config.scopes.includes(parsed.scope)) {
    issues.push({
      severity: 'warning',
      field: 'scope',
      message: `"${parsed.scope}" is not an allowed scope (${config.scopes.join(', ')})`,
    });
  }

  // Validate subject case — reject start-case, pascal-case, upper-case
  for (const [caseName, pattern] of CASE_PATTERNS) {
    if (pattern.test(parsed.subject)) {
      issues.push({
        severity: 'error',
        field: 'subject-case',
        message: `subject must not be ${caseName}`,
      });
      break;
    }
  }

  // Validate header length
  if (header.length > config.header_max_length) {
    issues.push({
      severity: 'error',
      field: 'header-max-length',
      message: `header is ${header.length} characters, maximum is ${config.header_max_length}`,
    });
  }

  // Validate body line length (warning severity)
  // Body starts after blank line (line index 2+)
  const bodyStart = lines.indexOf('', 1);
  if (bodyStart !== -1) {
    for (let i = bodyStart + 1; i < lines.length; i++) {
      const line = lines[i];
      if (line && line.length > config.body_max_line_length) {
        issues.push({
          severity: 'warning',
          field: 'body-max-line-length',
          message: `body line ${i + 1} is ${line.length} characters, maximum is ${config.body_max_line_length}`,
        });
        break; // Only report first violation
      }
    }
  }

  const hasErrors = issues.some((i) => i.severity === 'error');

  // Attach body to parsed result
  const body = bodyStart !== -1 ? lines.slice(bodyStart + 1).join('\n').trim() : undefined;
  const fullParsed: ParsedCommit = { ...parsed, body: body || undefined };

  return { valid: !hasErrors, issues, parsed: fullParsed };
}
