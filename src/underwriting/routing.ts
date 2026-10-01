export const canonicalUnderwritingPath='/underwriting';
export function isUnderwritingPath(path:string):boolean {
  const p=path.replace(/\/+$/,'').toLowerCase();
  return p==='/underwriting'||p==='/underwritin';
}
