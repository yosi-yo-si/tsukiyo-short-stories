import { readdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { createHash } from 'node:crypto';

export async function writeSecurityHeaders(dist) {
  const hashes = new Set();
  async function inspect(dir) {
    for (const entry of await readdir(dir, { withFileTypes: true })) {
      const target = path.join(dir, entry.name);
      if (entry.isDirectory()) await inspect(target);
      else if (entry.name.endsWith('.html')) {
        const html = await readFile(target, 'utf8');
        for (const match of html.matchAll(/<script(?:\s[^>]*)?>(.*?)<\/script>/gs)) {
          if (match[1]) hashes.add("'sha256-" + createHash('sha256').update(match[1]).digest('base64') + "'");
        }
      }
    }
  }
  await inspect(dist);
  const csp = "default-src 'self'; script-src 'self' " + [...hashes].sort().join(' ') + "; style-src 'self'; img-src 'self' data:; object-src 'none'; base-uri 'none'; frame-ancestors 'none'; form-action 'self'";
  if (csp.length > 2000) throw new Error('CSP exceeds the Pages header size limit');
  await writeFile(path.join(dist, '_headers'), '/*\n  Content-Security-Policy: ' + csp + '\n  X-Content-Type-Options: nosniff\n  X-Frame-Options: DENY\n  Referrer-Policy: no-referrer\n  Permissions-Policy: camera=(), microphone=(), geolocation=()\n  Strict-Transport-Security: max-age=31536000\n');
}
