// Integration test: needs a migrated database (run with DATABASE_URL pointing at a throwaway one).
import assert from 'node:assert/strict';
import type { Server } from 'node:http';
import { after, before, test } from 'node:test';
import { app } from '../src/app';
import { pool } from '../src/db/client';

let server: Server;
let base: string;

before(async () => {
  server = app.listen(0);
  base = `http://127.0.0.1:${(server.address() as { port: number }).port}`;
});
after(async () => {
  server.close();
  await pool.end();
});

/** Tiny client that keeps the session cookie between calls, like a browser would. */
function client() {
  let cookie = '';
  return async (method: string, path: string, body?: unknown) => {
    const res = await fetch(base + path, {
      method,
      headers: { 'Content-Type': 'application/json', ...(cookie ? { Cookie: cookie } : {}) },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    const set = res.headers.get('set-cookie');
    if (set) cookie = set.split(';')[0]!.endsWith('=') ? '' : set.split(';')[0]!;
    const text = await res.text();
    return { status: res.status, body: text ? JSON.parse(text) : null, setCookie: set };
  };
}

const rand = () => Math.random().toString(36).slice(2, 10);
const digits = () => String(Math.floor(100000 + Math.random() * 899999));
const kycBody = (cin: string, over: Record<string, unknown> = {}) => ({
  cin,
  fullName: 'Test User',
  dateOfBirth: '1999-05-20',
  expiryDate: '2035-01-01',
  consent: true,
  ...over,
});

test('nobody can purchase until signed in AND CIN-verified', async () => {
  const anon = client();
  assert.equal((await anon('POST', '/api/purchases', {})).status, 401, 'anonymous is rejected');
  assert.deepEqual((await anon('GET', '/api/auth/me')).body, { user: null });

  // sign up: session cookie is httpOnly, user starts unverified
  const a = client();
  const email = `a-${rand()}@example.com`;
  const signup = await a('POST', '/api/auth/signup', { email, password: 'correct horse', name: 'Aya Test' });
  assert.equal(signup.status, 201);
  assert.equal(signup.body.user.kycStatus, 'unverified');
  assert.match(signup.setCookie ?? '', /HttpOnly/i);
  assert.equal(signup.body.user.passwordHash, undefined, 'hash never leaves the server');
  assert.equal((await a('POST', '/api/auth/signup', { email, password: 'correct horse', name: 'Dup' })).status, 409);

  // unverified: gate says KYC_REQUIRED
  const blocked = await a('POST', '/api/purchases', {});
  assert.equal(blocked.status, 403);
  assert.equal(blocked.body.error, 'KYC_REQUIRED');

  // bad submissions are rejected and leave the user unverified
  assert.equal((await a('POST', '/api/kyc/cin', kycBody('12345'))).status, 422, 'bad format');
  assert.equal((await a('POST', '/api/kyc/cin', kycBody('AB' + digits(), { expiryDate: '2020-01-01' }))).status, 422, 'expired');
  assert.equal((await a('POST', '/api/kyc/cin', kycBody('AB' + digits(), { dateOfBirth: '2015-01-01' }))).status, 422, 'minor');
  assert.equal((await a('POST', '/api/kyc/cin', kycBody('AB' + digits(), { consent: false }))).status, 400, 'no consent');
  assert.equal((await a('POST', '/api/purchases', {})).status, 403);

  // valid CIN (lowercase + spaces are normalised) verifies the user
  const cin = 'ab' + digits();
  const ok = await a('POST', '/api/kyc/cin', kycBody(cin.slice(0, 2) + ' ' + cin.slice(2)));
  assert.equal(ok.status, 200);
  assert.equal(ok.body.user.kycStatus, 'verified');
  assert.equal(JSON.stringify(ok.body).toLowerCase().includes(cin), false, 'CIN is not echoed back');
  assert.equal((await a('GET', '/api/auth/me')).body.user.kycStatus, 'verified');

  // gate now lets the request through to the (not yet built) purchase handler
  assert.equal((await a('POST', '/api/purchases', {})).status, 501);

  // the same CIN cannot be linked to a second account
  const b = client();
  await b('POST', '/api/auth/signup', { email: `b-${rand()}@example.com`, password: 'another pass', name: 'Bilal Test' });
  const dup = await b('POST', '/api/kyc/cin', kycBody(cin));
  assert.equal(dup.status, 409);
  assert.equal(dup.body.error, 'CIN_IN_USE');
  assert.equal((await b('POST', '/api/purchases', {})).status, 403);

  // logout kills the session; login restores it; wrong password is refused
  await a('POST', '/api/auth/logout');
  assert.deepEqual((await a('GET', '/api/auth/me')).body, { user: null });
  assert.equal((await a('POST', '/api/auth/login', { email, password: 'wrong password' })).status, 401);
  const login = await a('POST', '/api/auth/login', { email, password: 'correct horse' });
  assert.equal(login.status, 200);
  assert.equal(login.body.user.kycStatus, 'verified', 'verification survives re-login');
});
