import type { RequestHandler } from 'express';

export const livenessHandler: RequestHandler = (_req, res) => {
  res.status(200).json({ status: 'ok' });
};
