import { Elysia, t } from 'elysia';
import { openapi } from '@elysiajs/openapi';

const port = Number(process.env.PORT) || 3999;

const app = new Elysia()
  .use(openapi())
  .get('/health', () => ({ status: 'ok' }), {
    detail: { summary: 'Health check', tags: ['system'] },
    response: t.Object({ status: t.String() }),
  })
  .get('/walks', () => [{ id: 1, name: 'Morning stroll' }], {
    detail: { summary: 'List walks', tags: ['walks'] },
    response: t.Array(t.Object({ id: t.Number(), name: t.String() })),
  })
  .listen(port);

console.log(`fixture-server running on port ${app.server?.port}`);
