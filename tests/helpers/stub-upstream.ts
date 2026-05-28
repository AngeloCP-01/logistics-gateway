import express from 'express';
import type { Express, Request, Response } from 'express';
import http from 'http';
import type { AddressInfo } from 'net';

type StubHeaders = Record<string, string | string[] | undefined>;

interface RecordedRequest {
  method: string;
  path: string;
  headers: StubHeaders;
  body: unknown;
}

export type StubHandler = (req: Request, res: Response, callIndex: number) => void;

export interface StubUpstream {
  url: string;
  port: number;
  recordedRequests: () => RecordedRequest[];
  setHandlers: (handlers: StubHandler[]) => void;
  close: () => Promise<void>;
}

export async function createStubUpstream(initialHandlers: StubHandler[] = []): Promise<StubUpstream> {
  let handlers = initialHandlers;
  let callIndex = 0;
  const records: RecordedRequest[] = [];

  const app: Express = express();
  app.use(express.json());
  app.use(express.text({ type: '*/*' }));
  app.all('*', (req, res) => {
    records.push({
      method: req.method,
      path: req.path,
      headers: req.headers as StubHeaders,
      body: req.body,
    });
    const handler =
      handlers[callIndex] ??
      handlers[handlers.length - 1] ??
      ((_q: Request, r: Response) => {
        r.status(200).json({ ok: true });
      });
    callIndex += 1;
    handler(req, res, callIndex - 1);
  });

  const server = http.createServer(app);
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const port = (server.address() as AddressInfo).port;

  return {
    url: `http://127.0.0.1:${port}`,
    port,
    recordedRequests: () => records,
    setHandlers: (h) => {
      handlers = h;
      callIndex = 0;
      records.length = 0;
    },
    close: () => new Promise<void>((resolve) => server.close(() => resolve())),
  };
}
