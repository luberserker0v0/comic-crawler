export function normalizeBrowserResourceUrl(value: string): string {
  const url = new URL(value);
  url.hash = '';
  return url.toString();
}
