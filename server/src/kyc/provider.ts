import { createHmac } from 'node:crypto';
import { env } from '../env';

export type KycInput = { cin: string; fullName: string; dateOfBirth: string; expiryDate: string };
export type KycFailure = 'BAD_FORMAT' | 'EXPIRED' | 'UNDERAGE';
/** `code` is what the client translates; `reason` is the English text for logs. */
export type KycResult = { ok: true } | { ok: false; code: KycFailure; reason: string };

/** Port: swap the mock for a real KYC vendor (document photo + selfie liveness) without touching routes. */
export interface KycProvider {
  verify(input: KycInput): Promise<KycResult>;
}

/** Moroccan CIN: one or two letters followed by five or six digits (e.g. AB123456, K12345). */
export const CIN_PATTERN = /^[A-Z]{1,2}\d{5,6}$/;

export const normalizeCin = (raw: string) => raw.replace(/[\s-]/g, '').toUpperCase();

/** One-way fingerprint stored instead of the CIN. */
export const fingerprintCin = (normalizedCin: string) =>
  createHmac('sha256', env.CIN_HASH_SECRET).update(normalizedCin).digest('hex');

const MIN_AGE_YEARS = 18;

/**
 * PROTOTYPE ONLY. This checks the format, the expiry date and the age. It does NOT
 * check the ID against any registry or photo, so it proves nothing about who the user is.
 */
export const mockKyc: KycProvider = {
  async verify({ cin, dateOfBirth, expiryDate }) {
    if (!CIN_PATTERN.test(cin)) {
      return { ok: false, code: 'BAD_FORMAT', reason: 'That does not look like a Moroccan CIN (for example AB123456).' };
    }
    const now = new Date();
    if (new Date(expiryDate) <= now) {
      return { ok: false, code: 'EXPIRED', reason: 'This CIN has expired. Renew it before verifying.' };
    }
    const adult = new Date(dateOfBirth);
    adult.setFullYear(adult.getFullYear() + MIN_AGE_YEARS);
    if (adult > now) {
      return { ok: false, code: 'UNDERAGE', reason: `You must be at least ${MIN_AGE_YEARS} years old.` };
    }
    return { ok: true };
  },
};

export const kyc: KycProvider = mockKyc;
