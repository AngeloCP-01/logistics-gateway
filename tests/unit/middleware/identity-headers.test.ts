import { buildUpstreamHeaders } from '@/middleware/identity-headers';

describe('buildUpstreamHeaders', () => {
  it('returns only X-Request-Id when identity is null', () => {
    expect(buildUpstreamHeaders(null, 'req-1')).toEqual({ 'X-Request-Id': 'req-1' });
  });

  it('returns user identity headers when kind=user', () => {
    expect(
      buildUpstreamHeaders({ kind: 'user', sub: 'u-1', role: 'customer' }, 'req-2'),
    ).toEqual({
      'X-Request-Id': 'req-2',
      'X-User-Id': 'u-1',
      'X-User-Role': 'customer',
    });
  });

  it('returns service identity headers when kind=service', () => {
    expect(
      buildUpstreamHeaders({ kind: 'service', svc: 'dispatch', aud: 'user-service' }, 'req-3'),
    ).toEqual({
      'X-Request-Id': 'req-3',
      'X-Service-Id': 'dispatch',
    });
  });
});
