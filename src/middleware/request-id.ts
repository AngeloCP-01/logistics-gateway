import { RequestHandler } from 'express';
import { v7 as uuidv7 } from 'uuid';

const INBOUND_PATTERN = /^[A-Za-z0-9_-]{1,64}$/;

declare global {
  namespace Express {
    interface Request {
      requestId?: string;
    }
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
