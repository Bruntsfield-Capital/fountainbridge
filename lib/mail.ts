import nodemailer from 'nodemailer';

/**
 * The studio's one way to send email (FB-279): Google Workspace, as the website sends, signed in as
 * john@bruntsfield.capital and shown as "Foundry Studio <john@bruntsfield.capital>".
 *
 * John sets `SMTP_HOST`, `SMTP_PORT`, `SMTP_USER`, `SMTP_PASS` and `SMTP_FROM` on production only.
 * Their values are never printed, logged or committed: a failure is logged by its error code alone.
 */
export interface MailSettings {
  host: string;
  port: number;
  user: string;
  pass: string;
  from: string;
}

export interface Mail {
  from: string;
  to: string;
  subject: string;
  text: string;
}

/**
 * Whether this studio is production: Railway's `RAILWAY_ENVIRONMENT_NAME` is exactly `production`.
 * Unset is not production. Only production messages founders (FB-279), so staging, previews and a
 * studio run on a laptop never send a founder anything, even with every setting copied over.
 */
export function isProduction(env: Record<string, string | undefined> = process.env): boolean {
  return env.RAILWAY_ENVIRONMENT_NAME?.trim() === 'production';
}

/**
 * The settings, or null when this studio must send no email.
 *
 * Null anywhere but production, even with every setting present: Railway's preview environments
 * copy production's variables (FB-243), and staging and previews must never send email.
 */
export function mailFromEnv(env: Record<string, string | undefined> = process.env): MailSettings | null {
  if (!isProduction(env)) return null;
  const host = env.SMTP_HOST?.trim();
  const user = env.SMTP_USER?.trim();
  const pass = env.SMTP_PASS;
  if (!host || !user || !pass) return null;
  const portText = env.SMTP_PORT?.trim() || '465';
  const port = Number(portText);
  if (!/^\d+$/.test(portText) || port < 1 || port > 65535) return null;
  return { host, port, user, pass, from: env.SMTP_FROM?.trim() || user };
}

/** Why `mailFromEnv` gave nothing, in words safe for a log: it names no value but the environment's. */
export function whyNoMail(env: Record<string, string | undefined> = process.env): string {
  if (!isProduction(env)) return `${notProduction(env)}, and only production sends email`;
  return 'this studio has no email settings';
}

/** Which environment this studio is on, when it is not production, in words safe for a log. */
export function notProduction(env: Record<string, string | undefined> = process.env): string {
  const railway = env.RAILWAY_ENVIRONMENT_NAME?.trim();
  return railway ? `this studio runs on Railway's "${railway}" environment` : 'this studio does not say it is production (RAILWAY_ENVIRONMENT_NAME is not set)';
}

const LOCAL = new Set(['127.0.0.1', 'localhost', '::1']);

/** Send one email. Never throws: a slow or broken mail server must not break what called it. */
export async function sendMail(settings: MailSettings, mail: Mail, opts: { log?: (line: string) => void } = {}): Promise<'sent' | 'failed'> {
  const log = opts.log ?? ((line: string) => console.error(line));
  try {
    const transport = nodemailer.createTransport({
      host: settings.host,
      port: settings.port,
      secure: settings.port === 465,
      // A password never crosses the network unencrypted. Only a server on this machine (the tests'
      // fake one) may be spoken to in the clear.
      requireTLS: !LOCAL.has(settings.host),
      auth: { user: settings.user, pass: settings.pass },
      connectionTimeout: 10_000,
      greetingTimeout: 10_000,
      socketTimeout: 15_000,
    });
    await transport.sendMail(mail);
    transport.close();
    return 'sent';
  } catch (e) {
    const code = (e as { code?: unknown })?.code;
    log(`[mail] an email could not be sent (${typeof code === 'string' ? code : 'no error code'}).`);
    return 'failed';
  }
}
