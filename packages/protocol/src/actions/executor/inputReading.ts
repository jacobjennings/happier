

export function normalizeId(raw: unknown): string {
  return String(raw ?? '').trim();
}

export function readNullableString(raw: unknown): string | null {
  return typeof raw === 'string' ? raw : null;
}

export function readOptionalString(raw: unknown): string | undefined {
  return typeof raw === 'string' ? raw : undefined;
}

function readFiniteNumber(raw: unknown): number | undefined {
  return typeof raw === 'number' && Number.isFinite(raw) ? raw : undefined;
}

function readStringRecord(raw: unknown): Record<string, string> | undefined {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return undefined;
  const entries = Object.entries(raw as Record<string, unknown>);
  if (!entries.every(([, value]) => typeof value === 'string')) return undefined;
  return Object.fromEntries(entries) as Record<string, string>;
}

export function assignIfDefined(target: Record<string, unknown>, key: string, value: unknown): void {
  if (value !== undefined) {
    target[key] = value;
  }
}
