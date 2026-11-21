import type { Request, Response } from 'express';
import type { z } from 'zod';

/** Every error the browser sees has the same shape: a stable code to branch on, and a message to show. */
export const fail = (res: Response, status: number, error: string, message: string) =>
  res.status(status).json({ error, message });

/** Returns the parsed body, or sends a 400 and returns undefined (callers just `return`). */
export function parseBody<T extends z.ZodType>(schema: T, req: Request, res: Response): z.infer<T> | undefined {
  const result = schema.safeParse(req.body);
  if (result.success) return result.data;
  fail(res, 400, 'INVALID', result.error.issues[0]?.message ?? 'Invalid request');
  return undefined;
}

/** Postgres unique-violation, whether drizzle wraps the driver error or not. */
export function isUniqueViolation(err: unknown): boolean {
  const e = err as { code?: string; cause?: { code?: string } };
  return e?.code === '23505' || e?.cause?.code === '23505';
}
