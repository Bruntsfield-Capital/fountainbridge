import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { PGlite } from '@electric-sql/pglite';
import type { VentureSummary } from '../ventures';
import { storedCard } from './review-fixtures';
import { fakeSmtp, type FakeSmtp } from './fake-smtp';

/**
 * The live wiring between the door and the messenger (FB-279): the settings it reads from the
 * environment, the venture it picks, and the database scope it runs in. Real Postgres under the
 * studio's own role, and a mail server on this machine that sends nothing.
 */
const SQL = ['001_read_model.sql', '005_push.sql', '012_schema_record.sql', '014_founder_messages.sql']
  .map((f) => readFileSync(join(process.cwd(), 'db', f), 'utf8')).join('\n');

let db: PGlite;
vi.mock('server-only', () => ({}));
vi.mock('../db', () => ({
  studioDatabase: (env: Record<string, string | undefined>) => (env.DATABASE_URL ? {} : null),
  withVenture: async <T,>(ventureId: string, fn: (q: unknown) => Promise<T>): Promise<T> => {
    await db.exec('begin');
    await db.query('select set_config($1, $2, true)', ['app.venture_id', ventureId]);
    try {
      const out = await fn(db);
      await db.exec('commit');
      return out;
    } catch (e) {
      await db.exec('rollback');
      throw e;
    }
  },
}));

const { founderMessenger } = await import('../founder-message-live');

const ARCA: VentureSummary = {
  id: 'arca', name: 'ARCA', description: null, status: 'active', founderName: 'Founder',
  founderEmail: 'Arca.Founder@bruntsfield.capital', repos: ['arca'], approvalMatrix: [], vpsHost: null, departments: [],
};

let smtp: FakeSmtp;
const env = (over: Record<string, string | undefined> = {}) => ({
  DATABASE_URL: 'postgres://studio',
  RAILWAY_ENVIRONMENT_NAME: 'production',
  STUDIO_PUBLIC_URL: 'https://studio.example',
  SMTP_HOST: '127.0.0.1',
  SMTP_PORT: String(smtp.port),
  SMTP_USER: 'john@bruntsfield.capital',
  SMTP_PASS: 'not-a-real-password',
  SMTP_FROM: 'Foundry Studio <john@bruntsfield.capital>',
  ...over,
});

beforeEach(async () => {
  smtp = await fakeSmtp();
  db = await PGlite.create();
  await db.exec(SQL);
  await db.exec('set role foundry_studio');
  vi.spyOn(console, 'log').mockImplementation(() => {});
});

afterEach(async () => {
  vi.restoreAllMocks();
  await smtp.close();
});

describe('founderMessenger', () => {
  it('emails ARCA’s founder once about a finished ARCA card, with a link into the studio', async () => {
    const message = founderMessenger(env(), [ARCA])!;
    await message('arca', storedCard('arca', 21));
    await message('arca', storedCard('arca', 21));
    expect(smtp.received).toHaveLength(1);
    expect(smtp.received[0].to).toEqual(['arca.founder@bruntsfield.capital']);
    expect(smtp.received[0].data).toContain('https://studio.example/venture/arca/');
  });

  it('messages nobody about a card of no known venture, and does not throw', async () => {
    await founderMessenger(env(), [ARCA])!('the-reset', storedCard('arca', 21));
    expect(smtp.received).toEqual([]);
  });

  it('sends no email on staging, even with every setting copied from production', async () => {
    await founderMessenger(env({ RAILWAY_ENVIRONMENT_NAME: 'staging' }), [ARCA])!('arca', storedCard('arca', 21));
    expect(smtp.received).toEqual([]);
  });

  it('is nothing at all on a studio with no database', () => {
    expect(founderMessenger(env({ DATABASE_URL: undefined }), [ARCA])).toBeNull();
  });
});
