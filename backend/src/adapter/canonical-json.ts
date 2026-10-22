export function canonicalJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(',')}]`;
  if (value && typeof value === 'object') return canonicalObject(value as Record<string, unknown>);
  return JSON.stringify(value) ?? 'null';
}

function canonicalObject(value: Record<string, unknown>): string {
  const entries = Object.entries(value).sort(([left], [right]) => left.localeCompare(right));
  return `{${entries.map(canonicalEntry).join(',')}}`;
}

function canonicalEntry([key, value]: [string, unknown]): string {
  return `${JSON.stringify(key)}:${canonicalJson(value)}`;
}
