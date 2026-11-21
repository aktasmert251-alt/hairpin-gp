import { readFileSync, existsSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { ROOT, walkFiles } from '../helpers/paths';

describe('legal release assets', () => {
  it('retires the three audited sponsor names from procedural boards and liveries', () => {
    const banned = /n[e]xa|p[u]lsar|h[a]lcyon/i;
    for (const dir of ['src/track', 'src/graphics']) {
      for (const file of walkFiles(path.join(ROOT, dir), (f) => /\.(ts|json|md)$/.test(f))) {
        expect(readFileSync(file, 'utf8'), file).not.toMatch(banned);
      }
    }
  });
  it('publishes the exact derived database files with attribution', () => {
    for (const id of ['istanbul', 'lombardia', 'bosphorus']) {
      expect(readFileSync(path.join(ROOT, `public/data/tracks/${id}.raw.json`)))
        .toEqual(readFileSync(path.join(ROOT, `src/track/data/${id}.raw.json`)));
    }
    const readme = readFileSync(path.join(ROOT, 'public/data/tracks/README.md'), 'utf8');
    for (const text of ['OpenStreetMap contributors', 'ODbL 1.0', 'https://www.openstreetmap.org/copyright', 'European Union', 'Copernicus Land Monitoring Service']) expect(readme).toContain(text);
  });
  it('ships notices and bilingual static legal pages', () => {
    const notices = readFileSync(path.join(ROOT, 'public/THIRD-PARTY-LICENSES.txt'), 'utf8');
    for (const text of ['three', 'postprocessing', 'n8ao', 'GreenSock', 'ws', 'lil-gui', 'SIL OPEN FONT LICENSE']) expect(notices).toContain(text);
    for (const [pkg, file] of [['three', 'LICENSE'], ['postprocessing', 'LICENSE.md'], ['n8ao', 'LICENSE'], ['ws', 'LICENSE'], ['lil-gui', 'LICENSE.md']]) {
      expect(notices, pkg).toContain(readFileSync(path.join(ROOT, `node_modules/${pkg}/${file}`), 'utf8').trim());
    }
    for (const doc of ['privacy', 'terms']) {
      expect(existsSync(path.join(ROOT, `docs/legal/${doc}.md`))).toBe(true);
      const html = readFileSync(path.join(ROOT, `public/legal/${doc}.html`), 'utf8');
      expect(html).toContain('lang="tr"'); expect(html).toContain('lang="en"');
      expect(html).not.toMatch(/<(script|link|img)\b/i);
    }
  });
  it('points to the repository Issues page (no in-game contact form) and keeps legal pages sub-path safe', () => {
    for (const doc of ['privacy', 'terms']) {
      for (const file of [`docs/legal/${doc}.md`, `public/legal/${doc}.html`]) {
        const text = readFileSync(path.join(ROOT, file), 'utf8');
        expect(text, file).toContain('Issues'); expect(text, file).toContain('garanti edilmez'); expect(text, file).toContain('not guaranteed');
        expect(text, file).not.toMatch(/İletişim formu|İletişim ekranı|Contact form|Contact screen|mailto:/);
        expect(text, file).not.toMatch(/30 gün|30 days/);
      }
    }
    for (const doc of ['privacy', 'kvkk', 'terms']) {
      expect(readFileSync(path.join(ROOT, `public/legal/${doc}.html`), 'utf8'), doc).not.toMatch(/(?:href|src)="\//);
    }
  });
});
