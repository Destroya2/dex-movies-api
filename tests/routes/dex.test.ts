import request from 'supertest';
import app from '../../src/index';

jest.mock('../../src/scrapers', () => {
  const mockData = {
    home: jest.fn().mockResolvedValue({
      data: {
        sections: [{ id: '1', title: 'Trending', type: 'row', items: [] }],
        tabs: [{ id: '1', title: 'Trending' }],
      },
      source: 'moviebox-hmac',
    }),
    search: jest.fn().mockResolvedValue({
      data: { items: [{ subjectId: '123', title: 'Test', type: 'movie' }], total: 1, page: 1 },
      source: 'moviebox-h5api',
    }),
    suggest: jest.fn().mockResolvedValue({
      data: [{ title: 'Avatar', subjectId: '456' }],
      source: 'moviebox-hmac',
    }),
    detail: jest.fn().mockResolvedValue({
      data: {
        subjectId: '123',
        title: 'Test Movie',
        posterUrl: 'https://example.com/poster.jpg',
        type: 'movie',
        year: '2024',
        rating: '8.5',
        plot: 'A test movie',
        dubs: [],
        freeEpisodes: 2,
      },
      source: 'moviebox-h5api',
    }),
    stream: jest.fn().mockResolvedValue({
      data: {
        sources: [{ url: 'https://example.com/stream.mp4', format: 'MP4', quality: 720 }],
        dubs: [],
        subtitles: [],
        hasResource: true,
        freeEpisodes: 2,
      },
      source: 'moviebox-h5api',
    }),
    category: jest.fn().mockResolvedValue({
      data: { items: [], page: 1, hasMore: false },
      source: 'moviebox-h5api',
    }),
  };

  return {
    ScraperEngine: jest.fn().mockImplementation(() => mockData),
  };
});

describe('Dex Routes', () => {
  describe('GET /', () => {
    it('should return API info', async () => {
      const res = await request(app).get('/');
      expect(res.status).toBe(200);
      expect(res.body.name).toBe('Dex Movies API');
      expect(res.body.endpoints).toBeDefined();
      expect(res.body.endpoints.home).toBe('GET /api/dex/home');
    });
  });

  describe('GET /api/dex/home', () => {
    it('should return home data with sections and tabs', async () => {
      const res = await request(app).get('/api/dex/home');
      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.data.sections).toBeDefined();
      expect(res.body.data.tabs).toBeDefined();
      expect(res.body.meta.source).toBe('moviebox-hmac');
    });
  });

  describe('GET /api/dex/search', () => {
    it('should return 400 if query is too short', async () => {
      const res = await request(app).get('/api/dex/search?q=a');
      expect(res.status).toBe(400);
      expect(res.body.error).toBeDefined();
    });

    it('should return search results for valid query', async () => {
      const res = await request(app).get('/api/dex/search?q=test');
      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.data.items).toBeDefined();
      expect(res.body.data.items.length).toBe(1);
    });
  });

  describe('GET /api/dex/suggest', () => {
    it('should return suggestions for valid query', async () => {
      const res = await request(app).get('/api/dex/suggest?q=ava');
      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.data).toBeDefined();
    });

    it('should return empty array for short query', async () => {
      const res = await request(app).get('/api/dex/suggest?q=a');
      expect(res.status).toBe(200);
      expect(res.body.data).toEqual([]);
    });
  });

  describe('GET /api/dex/detail/:subjectId', () => {
    it('should return detail data', async () => {
      const res = await request(app).get('/api/dex/detail/123');
      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.data.title).toBe('Test Movie');
      expect(res.body.data.rating).toBe('8.5');
    });

    it('should return 400 if subjectId is missing', async () => {
      const res = await request(app).get('/api/dex/detail/');
      expect(res.status).toBe(404);
    });
  });

  describe('GET /api/dex/stream/:subjectId', () => {
    it('should return stream data', async () => {
      const res = await request(app).get('/api/dex/stream/123');
      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.data.hasResource).toBe(true);
      expect(res.body.data.sources.length).toBeGreaterThan(0);
    });
  });

  describe('GET /api/dex/trending', () => {
    it('should return trending data', async () => {
      const res = await request(app).get('/api/dex/trending');
      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.data.items).toBeDefined();
    });
  });

  describe('GET /api/proxy/stream', () => {
    it('should return 400 if url is missing', async () => {
      const res = await request(app).get('/api/proxy/stream');
      expect(res.status).toBe(400);
    });

    it('should return 403 for disallowed domain', async () => {
      const res = await request(app).get('/api/proxy/stream?url=https://evil.com/file.mp4');
      expect(res.status).toBe(403);
    });
  });
});
