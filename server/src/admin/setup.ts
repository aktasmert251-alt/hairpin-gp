// Admin setup CLI (D-050): `node apex-server.mjs admin-setup <path/admin.json>` reads the password from stdin (first line;
// deploy/oracle/admin-setup.sh prompts for it hidden), generates a new TOTP secret, writes admin.json (mode 600) and prints
// the otpauth:// URI on stdout for the QR code. Running it again replaces both factors (lost phone / new password).
import { hashPassword, newTotpSecret, otpauthUri } from './crypto';
import type { AdminFile } from './admin';
import { writeJsonAtomic } from './files';

export const MIN_PASSWORD = 12;
export const ISSUER = 'HAIRPIN GP';

export async function writeAdminFile(file: string, password: string): Promise<{ uri: string; secret: string }> {
  if ([...password].length < MIN_PASSWORD) throw new Error(`password must have at least ${MIN_PASSWORD} characters`);
  const secret = newTotpSecret();
  const data: AdminFile = { v: 1, password: await hashPassword(password), totpSecret: secret, createdAt: new Date().toISOString() };
  writeJsonAtomic(file, data);
  return { uri: otpauthUri(secret, 'admin', ISSUER), secret };
}

async function readStdinLine(): Promise<string> {
  const chunks: Buffer[] = [];
  for await (const c of process.stdin) chunks.push(c as Buffer);
  return Buffer.concat(chunks).toString('utf8').split(/\r?\n/)[0] ?? '';
}

export async function runAdminSetup(file: string | undefined): Promise<number> {
  if (!file) {
    process.stderr.write('usage: node apex-server.mjs admin-setup <path/admin.json>   (password on stdin)\n');
    return 2;
  }
  try {
    const { uri } = await writeAdminFile(file, await readStdinLine());
    process.stderr.write(`wrote ${file}\n`);
    process.stdout.write(uri + '\n');
    return 0;
  } catch (err) {
    process.stderr.write(`ERROR: ${err instanceof Error ? err.message : String(err)}\n`);
    return 1;
  }
}
