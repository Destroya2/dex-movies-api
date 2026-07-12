import { generateXClientToken, generateXTrSignature, base64Encode, base64Decode } from '../../src/utils/crypto';

describe('crypto utils', () => {
  describe('base64Encode / base64Decode', () => {
    it('should encode and decode correctly', () => {
      const original = Buffer.from('Hello World 123!@#');
      const encoded = base64Encode(original);
      const decoded = base64Decode(encoded);
      expect(decoded.toString()).toBe('Hello World 123!@#');
    });

    it('should handle empty buffer', () => {
      expect(base64Encode(Buffer.from(''))).toBe('');
    });

    it('should handle unicode characters', () => {
      const original = Buffer.from('héllo wörld 🎬');
      const encoded = base64Encode(original);
      const decoded = base64Decode(encoded);
      expect(decoded.toString()).toBe('héllo wörld 🎬');
    });
  });

  describe('generateXClientToken', () => {
    it('should return a string with timestamp and hash separated by comma', () => {
      const token = generateXClientToken(1700000000000);
      expect(token).toMatch(/^\d{13},[a-f0-9]{32}$/);
    });

    it('should generate different tokens for different timestamps', () => {
      const t1 = generateXClientToken(1700000000000);
      const t2 = generateXClientToken(1700000000001);
      expect(t1).not.toBe(t2);
    });

    it('should work without explicit timestamp', () => {
      const token = generateXClientToken();
      expect(token).toMatch(/^\d{13},[a-f0-9]{32}$/);
    });
  });

  describe('generateXTrSignature', () => {
    it('should return a signature with format timestamp|2|base64', () => {
      const sig = generateXTrSignature('GET', null, null, 'https://api.example.com/path');
      expect(sig).toMatch(/^\d{13}\|2\|[A-Za-z0-9+/=]+$/);
    });

    it('should produce different signatures for different URLs', () => {
      const sig1 = generateXTrSignature('GET', null, null, 'https://api.example.com/a');
      const sig2 = generateXTrSignature('GET', null, null, 'https://api.example.com/b');
      expect(sig1).not.toBe(sig2);
    });

    it('should handle POST with body', () => {
      const sig = generateXTrSignature(
        'POST',
        'application/json',
        'application/json',
        'https://api.example.com/search',
        JSON.stringify({ keyword: 'test', page: 1 })
      );
      expect(sig).toMatch(/^\d{13}\|2\|[A-Za-z0-9+/=]+$/);
    });

    it('should include query parameters sorted in canonical string', () => {
      const ts = 1700000000000;
      const sig1 = generateXTrSignature(
        'GET', null, null,
        'https://api.example.com/search?q=test&page=1',
        null, undefined, ts
      );
      const sig2 = generateXTrSignature(
        'GET', null, null,
        'https://api.example.com/search?page=1&q=test',
        null, undefined, ts
      );
      expect(sig1).toBe(sig2);
    });
  });
});
