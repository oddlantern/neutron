import { describe, expect, test } from 'bun:test';

import { detectAdapter } from '../../src/plugins/builtin/openapi/adapters/index.js';
import { elysiaAdapter } from '../../src/plugins/builtin/openapi/adapters/elysia.js';
import { honoAdapter } from '../../src/plugins/builtin/openapi/adapters/hono.js';
import { expressAdapter } from '../../src/plugins/builtin/openapi/adapters/express.js';
import { fastifyAdapter } from '../../src/plugins/builtin/openapi/adapters/fastify.js';
import { koaAdapter } from '../../src/plugins/builtin/openapi/adapters/koa.js';
import { nestjsAdapter } from '../../src/plugins/builtin/openapi/adapters/nestjs.js';

describe('framework adapter detection', () => {
  test('elysia adapter detects elysia + @elysiajs/openapi', () => {
    const deps = { elysia: '^1.4.0', '@elysiajs/openapi': '^1.0.0' };
    expect(elysiaAdapter.detect(deps)).toBe(true);
  });

  test('elysia adapter detects elysia + @elysiajs/swagger (legacy)', () => {
    const deps = { elysia: '^1.4.0', '@elysiajs/swagger': '^1.0.0' };
    expect(elysiaAdapter.detect(deps)).toBe(true);
  });

  test('elysia adapter rejects without elysia', () => {
    const deps = { '@elysiajs/openapi': '^1.0.0' };
    expect(elysiaAdapter.detect(deps)).toBe(false);
  });

  test('hono adapter detects hono + hono-openapi', () => {
    const deps = { hono: '^4.0.0', 'hono-openapi': '^0.4.0' };
    expect(honoAdapter.detect(deps)).toBe(true);
  });

  test('hono adapter detects hono + @hono/zod-openapi', () => {
    const deps = { hono: '^4.0.0', '@hono/zod-openapi': '^0.1.0' };
    expect(honoAdapter.detect(deps)).toBe(true);
  });

  test('express adapter detects express + swagger-jsdoc', () => {
    const deps = { express: '^4.18.0', 'swagger-jsdoc': '^6.0.0' };
    expect(expressAdapter.detect(deps)).toBe(true);
  });

  test('fastify adapter detects fastify + @fastify/swagger', () => {
    const deps = { fastify: '^4.0.0', '@fastify/swagger': '^8.0.0' };
    expect(fastifyAdapter.detect(deps)).toBe(true);
  });

  test('koa adapter detects koa + swagger-jsdoc', () => {
    const deps = { koa: '^2.15.0', 'swagger-jsdoc': '^6.0.0' };
    expect(koaAdapter.detect(deps)).toBe(true);
  });

  test('nestjs adapter detects @nestjs/core + @nestjs/swagger', () => {
    const deps = { '@nestjs/core': '^10.0.0', '@nestjs/swagger': '^7.0.0' };
    expect(nestjsAdapter.detect(deps)).toBe(true);
  });
});

describe('detectAdapter', () => {
  test('returns elysia adapter for elysia + openapi deps', () => {
    const deps = { elysia: '^1.4.0', '@elysiajs/openapi': '^1.0.0' };
    const adapter = detectAdapter(deps);
    expect(adapter).not.toBeNull();
    expect(adapter?.name).toBe('elysia');
  });

  test('returns null when framework has no openapi plugin', () => {
    const deps = { express: '^4.18.0' };
    const adapter = detectAdapter(deps);
    expect(adapter).toBeNull();
  });

  test('returns null for empty deps', () => {
    const adapter = detectAdapter({});
    expect(adapter).toBeNull();
  });

  test('nestjs takes priority over express', () => {
    const deps = {
      '@nestjs/core': '^10.0.0',
      '@nestjs/swagger': '^7.0.0',
      express: '^4.18.0',
      'swagger-jsdoc': '^6.0.0',
    };
    const adapter = detectAdapter(deps);
    expect(adapter).not.toBeNull();
    expect(adapter?.name).toBe('nestjs');
  });

  test('nestjs takes priority over fastify', () => {
    const deps = {
      '@nestjs/core': '^10.0.0',
      '@nestjs/swagger': '^7.0.0',
      fastify: '^4.0.0',
      '@fastify/swagger': '^8.0.0',
    };
    const adapter = detectAdapter(deps);
    expect(adapter).not.toBeNull();
    expect(adapter?.name).toBe('nestjs');
  });
});
