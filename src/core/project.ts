// Public project identity for the static (GitHub Pages) build.
// PROJECT_URL is the public repository URL, e.g. 'https://github.com/<user>/<repo>'. Empty = not decided yet:
// every UI / legal text then shows the wording without a link ("the project repository's Issues page").

export const PROJECT_URL: string = 'https://github.com/aktasmert251-alt/hairpin-gp';

/** Repository URL (optionally with a sub path such as '/issues'); '' while PROJECT_URL is not set. */
export function projectUrl(sub = ''): string {
  const base = PROJECT_URL.trim().replace(/\/+$/, '');
  return base ? base + sub : '';
}

/** URL of a file shipped from public/, valid under any hosting sub-path (vite `base` is './'). */
export function publicUrl(path: string): string {
  return `${import.meta.env.BASE_URL}${path.replace(/^\/+/, '')}`;
}
