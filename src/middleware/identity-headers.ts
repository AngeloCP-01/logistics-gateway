// Local Identity type alias. The canonical Identity type will be exported by D2's
// jwt-validator.ts; D4 stays decoupled from that file by defining the same shape here.
export type Identity =
  | { kind: 'user'; sub: string; role: string }
  | { kind: 'service'; svc: string; aud: string };

export function buildUpstreamHeaders(
  identity: Identity | null,
  requestId: string,
): Record<string, string> {
  const base: Record<string, string> = { 'X-Request-Id': requestId };
  if (!identity) return base;
  if (identity.kind === 'user') {
    return { ...base, 'X-User-Id': identity.sub, 'X-User-Role': identity.role };
  }
  return { ...base, 'X-Service-Id': identity.svc };
}
