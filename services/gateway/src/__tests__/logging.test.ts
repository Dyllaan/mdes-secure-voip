import { sanitiseHeaders, sanitiseQuery, sanitiseUrlForLogs, serialiseRequestForLogs, serialiseResponseForLogs } from '../config/logging';

describe('gateway logging sanitisation', () => {
  it('redacts sensitive request headers and strips token query params', () => {
    const serialised = serialiseRequestForLogs({
      method: 'GET',
      url: '/peerjs/peerjs?token=super-secret&foo=bar',
      headers: {
        authorization: 'Bearer top-secret',
        cookie: 'refresh_token=abc',
        'x-bot-secret': 'bot-secret',
        'x-request-id': 'req-123',
      },
      socket: {
        remoteAddress: '127.0.0.1',
        remotePort: 8080,
      },
    } as any);

    expect(serialised.url).toBe('/peerjs/peerjs?foo=bar');
    expect(serialised.headers).toEqual(expect.objectContaining({
      authorization: '[Redacted]',
      cookie: '[Redacted]',
      'x-bot-secret': '[Redacted]',
      'x-request-id': 'req-123',
    }));
  });

  it('redacts set-cookie response headers', () => {
    const serialised = serialiseResponseForLogs({
      statusCode: 200,
      getHeaders: () => ({
        'set-cookie': ['refresh_token=abc; HttpOnly'],
        'content-type': 'application/json',
      }),
    } as any);

    expect(serialised.headers).toEqual(expect.objectContaining({
      'set-cookie': '[Redacted]',
      'content-type': 'application/json',
    }));
  });

  it('removes PeerJS token query params before explicit logging', () => {
    expect(sanitiseUrlForLogs('/peerjs/peerjs?token=upgrade-token&transport=websocket'))
      .toBe('/peerjs/peerjs?transport=websocket');
  });

  it('redacts headers without mutating unrelated values', () => {
    expect(sanitiseHeaders({
      authorization: 'Bearer token',
      accept: 'application/json',
    })).toEqual({
      authorization: '[Redacted]',
      accept: 'application/json',
    });
  });

  it('redacts sensitive query parameters without mutating unrelated ones', () => {
    expect(sanitiseQuery({
      token: 'abc',
      transport: 'websocket',
    })).toEqual({
      token: '[Redacted]',
      transport: 'websocket',
    });
  });
});
