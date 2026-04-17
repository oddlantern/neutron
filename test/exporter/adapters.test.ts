import { describe, expect, test } from 'bun:test';

import { detectAdapter } from '../../src/plugins/builtin/domain/openapi/adapters/index.js';
import { elysiaAdapter } from '../../src/plugins/builtin/domain/openapi/adapters/elysia.js';
import { honoAdapter } from '../../src/plugins/builtin/domain/openapi/adapters/hono.js';
import { expressAdapter } from '../../src/plugins/builtin/domain/openapi/adapters/express.js';
import { fastifyAdapter } from '../../src/plugins/builtin/domain/openapi/adapters/fastify.js';
import { koaAdapter } from '../../src/plugins/builtin/domain/openapi/adapters/koa.js';
import { nestjsAdapter } from '../../src/plugins/builtin/domain/openapi/adapters/nestjs.js';
import { fastapiAdapter } from '../../src/plugins/builtin/domain/openapi/adapters/fastapi.js';
import { axumAdapter } from '../../src/plugins/builtin/domain/openapi/adapters/axum.js';
import { humaAdapter } from '../../src/plugins/builtin/domain/openapi/adapters/huma.js';

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

  test('fastapi adapter detects fastapi in Python deps', () => {
    // FastAPI has builtin OpenAPI support — no separate plugin needed,
    // so the framework dep and the openapi dep are the same entry.
    const deps = { fastapi: '^0.110.0' };
    expect(fastapiAdapter.detect(deps)).toBe(true);

    const adapter = detectAdapter(deps);
    expect(adapter?.name).toBe('fastapi');
  });

  test('fastapi adapter rejects Python deps without fastapi', () => {
    const deps = { flask: '^3.0.0', uvicorn: '^0.29.0' };
    expect(fastapiAdapter.detect(deps)).toBe(false);
  });

  test('axum adapter detects axum + utoipa in Cargo deps', () => {
    const deps = { axum: '0.7', utoipa: '5.0', tokio: '1.40' };
    expect(axumAdapter.detect(deps)).toBe(true);

    const adapter = detectAdapter(deps);
    expect(adapter?.name).toBe('axum');
  });

  test('axum adapter rejects axum without utoipa (no OpenAPI capability)', () => {
    const deps = { axum: '0.7', tokio: '1.40' };
    expect(axumAdapter.detect(deps)).toBe(true);
    // detect() matches on framework, but detectAdapter requires an
    // openapi plugin (utoipa) too.
    expect(detectAdapter(deps)).toBeNull();
  });

  test('huma adapter detects huma v2 from go.mod deps', () => {
    const deps = {
      'github.com/danielgtaylor/huma/v2': 'v2.27.0',
      'github.com/gin-gonic/gin': 'v1.9.0',
    };
    expect(humaAdapter.detect(deps)).toBe(true);
    // huma carries its own OpenAPI capability — framework + openapi
    // plugin are the same import.
    const adapter = detectAdapter(deps);
    expect(adapter?.name).toBe('huma');
  });

  test('huma adapter detects future huma versions via import-path prefix', () => {
    // When huma/v3 eventually ships, detect() still matches by prefix.
    // Documents that detectAdapter additionally gates on openapiPlugins
    // though — a v3 bump needs an entry there too.
    const deps = { 'github.com/danielgtaylor/huma/v3': 'v3.0.0-beta' };
    expect(humaAdapter.detect(deps)).toBe(true);
    expect(detectAdapter(deps)).toBeNull();
  });

  test('huma adapter rejects go.mod without huma', () => {
    const deps = {
      'github.com/gin-gonic/gin': 'v1.9.0',
      'github.com/go-chi/chi/v5': 'v5.0.0',
    };
    expect(humaAdapter.detect(deps)).toBe(false);
  });

});
