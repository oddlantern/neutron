import { describe, expect, test } from 'bun:test';

import type { CommitsConfig } from '../../src/config/schema.js';
import { validateCommitMessage } from '../../src/commit/validator.js';

const defaultConfig: CommitsConfig = {
  types: ['feat', 'fix', 'docs', 'chore', 'refactor', 'test', 'build', 'ci', 'perf', 'style', 'revert'],
  scopes: ['config', 'graph', 'check', 'cli'],
  header_max_length: 100,
  body_max_line_length: 200,
};

const configNoScopes: CommitsConfig = {
  ...defaultConfig,
  scopes: undefined,
};

describe('validateCommitMessage', () => {
  test('valid conventional commit is accepted', () => {
    const result = validateCommitMessage('feat(config): add new option', defaultConfig);
    expect(result.valid).toBe(true);
    expect(result.issues).toHaveLength(0);
    expect(result.parsed).not.toBeNull();
    expect(result.parsed?.type).toBe('feat');
    expect(result.parsed?.scope).toBe('config');
    expect(result.parsed?.subject).toBe('add new option');
    expect(result.parsed?.breaking).toBe(false);
  });

  test('invalid type is rejected with error', () => {
    const result = validateCommitMessage('bogus(config): do something', defaultConfig);
    expect(result.valid).toBe(false);
    const typeIssue = result.issues.find((i) => i.field === 'type');
    expect(typeIssue).toBeDefined();
    expect(typeIssue?.severity).toBe('error');
    expect(typeIssue?.message).toContain('bogus');
  });

  test('unknown scope issues warning when scopes configured', () => {
    const result = validateCommitMessage('feat(unknown-scope): do something', defaultConfig);
    const scopeIssue = result.issues.find((i) => i.field === 'scope');
    expect(scopeIssue).toBeDefined();
    expect(scopeIssue?.severity).toBe('warning');
    expect(scopeIssue?.message).toContain('unknown-scope');
    // Warning only — still valid if no errors
    expect(result.valid).toBe(true);
  });

  test('unknown scope is not flagged when no scopes configured', () => {
    const result = validateCommitMessage('feat(anything): do something', configNoScopes);
    const scopeIssue = result.issues.find((i) => i.field === 'scope');
    expect(scopeIssue).toBeUndefined();
  });

  test('subject in start-case is rejected', () => {
    // "Add New Option" matches start-case: /^[A-Z][a-z]+(?:\s[A-Z][a-z]+)*$/
    const result = validateCommitMessage('feat(config): Add New Option', defaultConfig);
    expect(result.valid).toBe(false);
    const caseIssue = result.issues.find((i) => i.field === 'subject-case');
    expect(caseIssue).toBeDefined();
    expect(caseIssue?.severity).toBe('error');
  });

  test('subject in pascal-case is rejected', () => {
    // "AddNewOption" matches pascal-case: /^[A-Z][a-zA-Z0-9]+$/
    const result = validateCommitMessage('feat(config): AddNewOption', defaultConfig);
    expect(result.valid).toBe(false);
    const caseIssue = result.issues.find((i) => i.field === 'subject-case');
    expect(caseIssue).toBeDefined();
    expect(caseIssue?.severity).toBe('error');
  });

  test('subject in UPPER CASE is rejected', () => {
    // "ADD NEW OPTION" matches upper-case: /^[A-Z\s]+$/
    const result = validateCommitMessage('feat(config): ADD NEW OPTION', defaultConfig);
    expect(result.valid).toBe(false);
    const caseIssue = result.issues.find((i) => i.field === 'subject-case');
    expect(caseIssue).toBeDefined();
    expect(caseIssue?.severity).toBe('error');
  });

  test('header over max length is flagged', () => {
    const longSubject = 'a'.repeat(90);
    const message = `feat(config): ${longSubject}`;
    expect(message.length).toBeGreaterThan(100);
    const result = validateCommitMessage(message, defaultConfig);
    expect(result.valid).toBe(false);
    const lengthIssue = result.issues.find((i) => i.field === 'header-max-length');
    expect(lengthIssue).toBeDefined();
    expect(lengthIssue?.severity).toBe('error');
    expect(lengthIssue?.message).toContain('100');
  });

  test('commit with body passes and body is attached to parsed', () => {
    const message = 'feat(config): add new option\n\nThis is the body of the commit.';
    const result = validateCommitMessage(message, defaultConfig);
    expect(result.valid).toBe(true);
    expect(result.parsed?.body).toBe('This is the body of the commit.');
  });

  test('commit with no scope is accepted', () => {
    const result = validateCommitMessage('fix: correct typo in output', defaultConfig);
    expect(result.valid).toBe(true);
    expect(result.parsed?.scope).toBeUndefined();
    expect(result.parsed?.type).toBe('fix');
    expect(result.parsed?.subject).toBe('correct typo in output');
  });

  test('breaking change marker ! is parsed correctly', () => {
    const result = validateCommitMessage('feat(config)!: drop old format', defaultConfig);
    expect(result.valid).toBe(true);
    expect(result.parsed?.breaking).toBe(true);
  });

  test('breaking change without scope is parsed correctly', () => {
    const result = validateCommitMessage('refactor!: remove deprecated api', defaultConfig);
    expect(result.valid).toBe(true);
    expect(result.parsed?.breaking).toBe(true);
    expect(result.parsed?.scope).toBeUndefined();
  });

  test('malformed header produces format error', () => {
    const result = validateCommitMessage('this is not a conventional commit', defaultConfig);
    expect(result.valid).toBe(false);
    expect(result.parsed).toBeNull();
    const formatIssue = result.issues.find((i) => i.field === 'format');
    expect(formatIssue).toBeDefined();
    expect(formatIssue?.severity).toBe('error');
  });

  test('body line exceeding max length produces warning', () => {
    const longLine = 'x'.repeat(201);
    const message = `feat(config): add new option\n\n${longLine}`;
    const result = validateCommitMessage(message, defaultConfig);
    // body_max_line_length is a warning, not an error — commit is still valid
    expect(result.valid).toBe(true);
    const bodyIssue = result.issues.find((i) => i.field === 'body-max-line-length');
    expect(bodyIssue).toBeDefined();
    expect(bodyIssue?.severity).toBe('warning');
    expect(bodyIssue?.message).toContain('200');
  });

  test('header exactly at max length passes', () => {
    // Construct a header that is exactly 100 chars
    const header = 'feat(config): ' + 'a'.repeat(100 - 'feat(config): '.length);
    expect(header.length).toBe(100);
    const result = validateCommitMessage(header, defaultConfig);
    const lengthIssue = result.issues.find((i) => i.field === 'header-max-length');
    expect(lengthIssue).toBeUndefined();
  });
});
