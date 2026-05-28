import request from 'supertest';
import { Writable } from 'stream';
import pino from 'pino';
import { bootstrap, type Bootstrap } from '@tests/helpers/bootstrap';
import { validUserJwt } from '@tests/helpers/jwt-fixtures';

describe('I20 logging redaction', () => {
  let b: Bootstrap;
  let captured: string;
  let sink: Writable;

  beforeAll(async () => {
    captured = '';
    sink = new Writable({
      write(chunk, _enc, cb) {
        captured += chunk.toString();
        cb();
      },
    });
    const logger = pino(
      {
        level: 'info',
        redact: {
          paths: [
            'req.headers.authorization',
            'req.headers["x-service-authorization"]',
            'req.headers.cookie',
            'res.headers["set-cookie"]',
          ],
          remove: true,
        },
      },
      sink,
    );
    b = await bootstrap({ logger });
  }, 60_000);

  afterAll(async () => {
    await b.close();
  });

  it('does not log Authorization, X-Service-Authorization, or Cookie', async () => {
    const token = validUserJwt();
    b.userStub!.setHandlers([(_req, res) => res.status(200).json({ ok: true })]);

    captured = '';
    await request(b.server)
      .get('/v1/users/me')
      .set('Authorization', `Bearer ${token}`)
      .set('X-Service-Authorization', 'Bearer should-not-appear')
      .set('Cookie', 'session=should-not-appear');

    expect(captured.length).toBeGreaterThan(0); // sanity: something WAS logged
    expect(captured).not.toContain(token);
    expect(captured.toLowerCase()).not.toContain('authorization');
    expect(captured.toLowerCase()).not.toContain('cookie');
    expect(captured).not.toContain('should-not-appear');
  });
});
