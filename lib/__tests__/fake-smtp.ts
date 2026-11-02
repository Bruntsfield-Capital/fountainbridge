import { createServer, type AddressInfo, type Server } from 'node:net';

/**
 * A mail server on this machine that sends nothing (FB-279): the tests never send real email.
 *
 * It speaks just enough SMTP for nodemailer, in the clear (no STARTTLS offered), accepts any login,
 * and keeps each message it is given.
 */
export interface FakeSmtp {
  port: number;
  received: { from: string; to: string[]; data: string; auth: string | null }[];
  close(): Promise<void>;
}

export async function fakeSmtp(): Promise<FakeSmtp> {
  const received: FakeSmtp['received'] = [];
  const server: Server = createServer((socket) => {
    socket.setEncoding('utf8');
    let buffer = '';
    let inData = false;
    let auth: string | null = null;
    let from = '';
    let to: string[] = [];
    let data: string[] = [];
    let awaiting: 'login-user' | 'login-pass' | null = null;
    const say = (line: string) => socket.write(`${line}\r\n`);
    say('220 fake.smtp ready');
    socket.on('data', (chunk: string) => {
      buffer += chunk;
      let at: number;
      while ((at = buffer.indexOf('\r\n')) >= 0) {
        const line = buffer.slice(0, at);
        buffer = buffer.slice(at + 2);
        if (inData) {
          if (line === '.') {
            received.push({ from, to, data: data.join('\r\n'), auth });
            inData = false;
            data = [];
            say('250 kept');
          } else data.push(line.startsWith('..') ? line.slice(1) : line);
          continue;
        }
        if (awaiting === 'login-user') { auth = Buffer.from(line, 'base64').toString(); awaiting = 'login-pass'; say('334 UGFzc3dvcmQ6'); continue; }
        if (awaiting === 'login-pass') { awaiting = null; say('235 ok'); continue; }
        const verb = line.slice(0, 4).toUpperCase();
        if (verb === 'EHLO') { say('250-fake.smtp'); say('250 AUTH PLAIN LOGIN'); }
        else if (verb === 'HELO') say('250 fake.smtp');
        else if (verb === 'AUTH') {
          const [, kind, initial] = line.split(' ');
          if (kind?.toUpperCase() === 'PLAIN') { auth = initial ? Buffer.from(initial, 'base64').toString().split('\0')[1] ?? null : null; say('235 ok'); }
          else { awaiting = 'login-user'; say('334 VXNlcm5hbWU6'); }
        } else if (verb === 'MAIL') { from = /<([^>]*)>/.exec(line)?.[1] ?? ''; to = []; say('250 ok'); }
        else if (verb === 'RCPT') { to.push(/<([^>]*)>/.exec(line)?.[1] ?? ''); say('250 ok'); }
        else if (verb === 'DATA') { inData = true; say('354 go on'); }
        else if (verb === 'RSET') say('250 ok');
        else if (verb === 'QUIT') { say('221 bye'); socket.end(); }
        else say('250 ok');
      }
    });
    socket.on('error', () => {});
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  return {
    port: (server.address() as AddressInfo).port,
    received,
    close: () => new Promise<void>((resolve) => server.close(() => resolve())),
  };
}
