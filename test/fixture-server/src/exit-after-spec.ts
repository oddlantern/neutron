import { Elysia, t } from 'elysia';
import { openapi } from '@elysiajs/openapi';

const port = Number(process.env.PORT) || 3999;

let specServed = false;

const app = new Elysia()
  .use(openapi())
  .get('/health', () => ({ status: 'ok' }), {
    detail: { summary: 'Health check', tags: ['system'] },
    response: t.Object({ status: t.String() }),
  })
  .onAfterResponse(({ path }) => {
    // Exit with non-zero code after serving the OpenAPI spec (simulates SIGTERM behavior)
    if (path === '/openapi/json' && !specServed) {
      specServed = true;
      setTimeout(() => process.exit(1), 50);
    }
  })
  .listen(port);

console.log(`exit-after-spec server running on port ${app.server?.port}`);
