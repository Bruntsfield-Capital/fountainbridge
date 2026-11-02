import { describe, it, expect, afterEach } from 'vitest';
import { createServer, type AddressInfo } from 'node:net';
import { isProduction, mailFromEnv, sendMail, whyNoMail } from '../mail';
import { fakeSmtp, type FakeSmtp } from './fake-smtp';

/**
 * The studio's email (FB-279), against a fake mail server on this machine. Nothing here sends real
 * email.
 */
const PASS = 'not-a-real-password-9c1e';
const FULL = {
  RAILWAY_ENVIRONMENT_NAME: 'production',
  SMTP_HOST: 'smtp.gmail.com',
  SMTP_PORT: '465',
  SMTP_USER: 'john@bruntsfield.capital',
  SMTP_PASS: PASS,
  SMTP_FROM: 'Foundry Studio <john@bruntsfield.capital>',
};

let server: FakeSmtp | null = null;
afterEach(async () => { await server?.close(); server = null; });

describe('the settings', () => {
  it('are read when every one is present', () => {
    expect(mailFromEnv(FULL)).toEqual({ host: 'smtp.gmail.com', port: 465, user: 'john@bruntsfield.capital', pass: PASS, from: FULL.SMTP_FROM });
    expect(mailFromEnv({ ...FULL, RAILWAY_ENVIRONMENT_NAME: ' production ' })).not.toBeNull();
  });

  it('default to port 465 and to the user as the sender', () => {
    expect(mailFromEnv({ ...FULL, SMTP_PORT: undefined, SMTP_FROM: undefined })).toMatchObject({ port: 465, from: 'john@bruntsfield.capital' });
  });

  it('are nothing when one that is needed is missing, or the port is not a port', () => {
    for (const missing of ['SMTP_HOST', 'SMTP_USER', 'SMTP_PASS'] as const) {
      expect(mailFromEnv({ ...FULL, [missing]: undefined })).toBeNull();
      expect(mailFromEnv({ ...FULL, [missing]: '' })).toBeNull();
    }
    for (const port of ['0', '65536', 'smtp', '4.5']) expect(mailFromEnv({ ...FULL, SMTP_PORT: port })).toBeNull();
  });

  it('are nothing on staging and on a preview, even when copied from production', () => {
    expect(mailFromEnv({ ...FULL, RAILWAY_ENVIRONMENT_NAME: 'staging' })).toBeNull();
    expect(mailFromEnv({ ...FULL, RAILWAY_ENVIRONMENT_NAME: 'pr-316' })).toBeNull();
    expect(whyNoMail({ ...FULL, RAILWAY_ENVIRONMENT_NAME: 'staging' })).toMatch(/"staging" environment, and only production sends email/);
    expect(whyNoMail({ RAILWAY_ENVIRONMENT_NAME: 'production' })).toBe('this studio has no email settings');
  });

  it('are nothing unless the environment is exactly production, and unset is not production', () => {
    for (const name of [undefined, '', 'Production', 'production-copy', 'pr-316 production']) {
      expect(isProduction({ RAILWAY_ENVIRONMENT_NAME: name })).toBe(false);
      expect(mailFromEnv({ ...FULL, RAILWAY_ENVIRONMENT_NAME: name })).toBeNull();
    }
    expect(isProduction({ RAILWAY_ENVIRONMENT_NAME: ' production ' })).toBe(true);
    expect(whyNoMail({ ...FULL, RAILWAY_ENVIRONMENT_NAME: undefined })).toBe(
      'this studio does not say it is production (RAILWAY_ENVIRONMENT_NAME is not set), and only production sends email',
    );
  });
});

describe('sending', () => {
  it('a message reaches the mail server from Foundry Studio, to the founder, with its link', async () => {
    server = await fakeSmtp();
    const r = await sendMail(
      { host: '127.0.0.1', port: server.port, user: 'john@bruntsfield.capital', pass: PASS, from: 'Foundry Studio <john@bruntsfield.capital>' },
      { from: 'Foundry Studio <john@bruntsfield.capital>', to: 'arca.founder@bruntsfield.capital', subject: 'ARCA: your team finished something', text: 'Open it in the studio: https://studio.example/venture/arca/review/arca/21\n' },
    );
    expect(r).toBe('sent');
    expect(server.received).toHaveLength(1);
    const [m] = server.received;
    expect(m.auth).toBe('john@bruntsfield.capital');
    expect(m.to).toEqual(['arca.founder@bruntsfield.capital']);
    expect(m.data).toMatch(/^From: Foundry Studio <john@bruntsfield\.capital>$/m);
    expect(m.data).toMatch(/^To: arca\.founder@bruntsfield\.capital$/m);
    expect(m.data).toMatch(/^Subject: ARCA: your team finished something$/m);
    expect(m.data).toContain('https://studio.example/venture/arca/review/arca/21');
  });

  it('a server that is not there is a failure, said without the password, and nothing throws', async () => {
    const closed = createServer();
    await new Promise<void>((resolve) => closed.listen(0, '127.0.0.1', resolve));
    const port = (closed.address() as AddressInfo).port;
    await new Promise<void>((resolve) => closed.close(() => resolve()));

    const lines: string[] = [];
    const r = await sendMail(
      { host: '127.0.0.1', port, user: 'john@bruntsfield.capital', pass: PASS, from: 'x@bruntsfield.capital' },
      { from: 'x@bruntsfield.capital', to: 'y@bruntsfield.capital', subject: 's', text: 't' },
      { log: (l) => lines.push(l) },
    );
    expect(r).toBe('failed');
    expect(lines).toHaveLength(1);
    expect(lines[0]).toMatch(/could not be sent \(E[A-Z]+\)\.$/);
    expect(lines.join('\n')).not.toContain(PASS);
    expect(lines.join('\n')).not.toContain('john@bruntsfield.capital');
  });
});
