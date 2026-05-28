import type { RequestHandler } from 'express';
import { v7 as uuidv7 } from 'uuid';

const INBOUND_PATTERN = /^[A-Za-z0-9_-]{1,64}$/;

// Augment Express.Request with requestId so downstream middleware and handlers
// can access it without casting. Using module augmentation (not a namespace
// declaration) avoids the @typescript-eslint/no-namespace lint rule.
declare module 'express-serve-static-core' {
  interface Request {
    requestId?: string;
  }
}

export const requestIdMiddleware: RequestHandler = (req, res, next) => {
  const inbound = req.headers['x-request-id'];
  const single = Array.isArray(inbound) ? inbound[0] : inbound;
  const id = single && INBOUND_PATTERN.test(single) ? single : uuidv7();
  req.requestId = id;
  res.setHeader('X-Request-Id', id);
  next();
};
