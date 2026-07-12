import { buildSignedHeaders, buildPlayerHeaders } from '../../src/utils/headers';

describe('headers utils', () => {
  describe('buildSignedHeaders', () => {
    it('should return object with required headers', () => {
      const headers = buildSignedHeaders({
        url: 'https://api.example.com/test',
        profile: 'detail',
      });

      expect(headers['user-agent']).toBeDefined();
      expect(headers['accept']).toBe('application/json');
      expect(headers['content-type']).toBe('application/json');
      expect(headers['x-client-token']).toBeDefined();
      expect(headers['x-tr-signature']).toBeDefined();
      expect(headers['x-client-info']).toBeDefined();
      expect(headers['x-client-status']).toBe('0');
    });

    it('should add Authorization header when token is provided', () => {
      const headers = buildSignedHeaders({
        url: 'https://api.example.com/test',
        token: 'my-bearer-token',
      });
      expect(headers['Authorization']).toBe('Bearer my-bearer-token');
    });

    it('should add stream-specific headers for stream profile', () => {
      const headers = buildSignedHeaders({
        url: 'https://api.example.com/stream',
        profile: 'stream',
      });
      expect(headers['X-Play-Mode']).toBe('1');
      expect(headers['X-Idle-Data']).toBe('1');
      expect(headers['X-Family-Mode']).toBe('0');
      expect(headers['X-Content-Mode']).toBe('0');
    });

    it('should include extra headers', () => {
      const headers = buildSignedHeaders({
        url: 'https://api.example.com/test',
        extraHeaders: { 'X-Custom': 'value' },
      });
      expect(headers['X-Custom']).toBe('value');
    });

    it('should include valid x-client-token format', () => {
      const headers = buildSignedHeaders({ url: 'https://api.example.com/test' });
      expect(headers['x-client-token']).toMatch(/^\d{13},[a-f0-9]{32}$/);
    });

    it('should include valid x-tr-signature format', () => {
      const headers = buildSignedHeaders({ url: 'https://api.example.com/test' });
      expect(headers['x-tr-signature']).toMatch(/^\d{13}\|2\|[A-Za-z0-9+/=]+$/);
    });
  });

  describe('buildPlayerHeaders', () => {
    it('should return CDN-compatible headers', () => {
      const headers = buildPlayerHeaders('https://netfilm.world/spa/video');
      expect(headers['User-Agent']).toContain('Chrome/148');
      expect(headers['Referer']).toBe('https://netfilm.world/spa/video');
      expect(headers['sec-ch-ua']).toBeDefined();
    });
  });
});
