#!/usr/bin/env node
//#endregion
//#region src/plugins/builtin/openapi/adapters/index.ts
/**
* Ordered list of framework adapters.
* More specific frameworks come first to avoid false positives
* (e.g., NestJS uses Express or Fastify underneath).
*/
const ADAPTERS = [
	{
		name: "nestjs",
		detect(deps) {
			return "@nestjs/core" in deps;
		},
		openapiPlugins: ["@nestjs/swagger"],
		defaultSpecPath: "/api-docs-json",
		fallbackSpecPaths: ["/swagger-json", "/openapi.json"]
	},
	{
		name: "elysia",
		detect(deps) {
			return "elysia" in deps;
		},
		openapiPlugins: ["@elysiajs/openapi", "@elysiajs/swagger"],
		defaultSpecPath: "/openapi/json",
		fallbackSpecPaths: ["/swagger/json"]
	},
	{
		name: "hono",
		detect(deps) {
			return "hono" in deps;
		},
		openapiPlugins: [
			"hono-openapi",
			"@hono/zod-openapi",
			"@rcmade/hono-docs"
		],
		defaultSpecPath: "/openapi",
		fallbackSpecPaths: [
			"/doc",
			"/docs/open-api",
			"/api-docs"
		]
	},
	{
		name: "fastify",
		detect(deps) {
			return "fastify" in deps;
		},
		openapiPlugins: ["@fastify/swagger"],
		defaultSpecPath: "/documentation/json",
		fallbackSpecPaths: ["/swagger/json", "/openapi.json"]
	},
	{
		name: "express",
		detect(deps) {
			return "express" in deps;
		},
		openapiPlugins: [
			"swagger-jsdoc",
			"swagger-ui-express",
			"express-openapi-validator"
		],
		defaultSpecPath: "/api-docs",
		fallbackSpecPaths: [
			"/swagger.json",
			"/openapi.json",
			"/docs/json"
		]
	},
	{
		name: "koa",
		detect(deps) {
			return "koa" in deps;
		},
		openapiPlugins: ["koa2-swagger-ui", "swagger-jsdoc"],
		defaultSpecPath: "/swagger.json",
		fallbackSpecPaths: ["/api-docs", "/openapi.json"]
	}
];
/**
* Detect which framework adapter matches the given package dependencies.
* Checks for both the framework dep and at least one OpenAPI plugin dep.
* Returns the first match, or null if no adapter applies.
*/
function detectAdapter(deps) {
	for (const adapter of ADAPTERS) {
		if (!adapter.detect(deps)) continue;
		if (adapter.openapiPlugins.some((plugin) => plugin in deps)) return adapter;
	}
	return null;
}
//#endregion
export { detectAdapter };

//# sourceMappingURL=adapters-DlQP7ll8.js.map