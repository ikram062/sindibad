import type { NextFunction, Request, Response } from 'express';
import { fail } from './http';
import { type SessionUser, userFromRequest } from './session';

declare global {
  // eslint-disable-next-line @typescript-eslint/no-namespace
  namespace Express {
    interface Request {
      user?: SessionUser;
    }
  }
}

export async function requireAuth(req: Request, res: Response, next: NextFunction) {
  const user = await userFromRequest(req);
  if (!user) return fail(res, 401, 'UNAUTHENTICATED', 'Please sign in.');
  req.user = user;
  next();
}

/** The purchase gate: signed in AND CIN verified. Mount every purchase route behind this. */
export const requireKyc = [
  requireAuth,
  (req: Request, res: Response, next: NextFunction) => {
    if (req.user?.kycStatus !== 'verified') {
      return fail(res, 403, 'KYC_REQUIRED', 'Verify your CIN before buying anything.');
    }
    next();
  },
];
