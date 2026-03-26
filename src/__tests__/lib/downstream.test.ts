import { searchFromApi } from '@/lib/downstream';

// ── mocks ────────────────────────────────────────────────────────────────────

const mockFetch = jest.fn();
global.fetch = mockFetch;

jest.mock('@/lib/config', () => ({
  API_CONFIG: {
    search: {
      path: '?ac=videolist&wd=',
      pagePath: '?ac=videolist&wd={query}&pg={page}',
      headers: { 'User-Agent': 'test', Accept: 'application/json' },
    },
    detail: {
      path: '?ac=videolist&ids=',
      headers: { 'User-Agent': 'test', Accept: 'application/json' },
    },
  },
  getConfig: jest.fn().mockResolvedValue({
    SiteConfig: { SearchDownstreamMaxPage: 5 },
  }),
}));

jest.mock('@/lib/utils', () => ({
  cleanHtmlTags: jest.fn((s: string) => s),
}));

// ── helpers ───────────────────────────────────────────────────────────────────

const TEST_SITE = {
  key: 'test',
  api: 'https://api.example.com/',
  name: 'Test Source',
};

function makeApiResponse(items: object[], pagecount = 1) {
  return {
    ok: true,
    json: () => Promise.resolve({ list: items, pagecount }),
  };
}

// ── tests ─────────────────────────────────────────────────────────────────────

describe('searchFromApi', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('returns an empty array when the upstream response is not ok', async () => {
    mockFetch.mockResolvedValue({ ok: false, status: 500 });

    const results = await searchFromApi(TEST_SITE, 'query');
    expect(results).toEqual([]);
  });

  it('returns an empty array when the list is missing or empty', async () => {
    mockFetch.mockResolvedValue({
      ok: true,
      json: () => Promise.resolve({ list: [] }),
    });

    const results = await searchFromApi(TEST_SITE, 'query');
    expect(results).toEqual([]);
  });

  it('returns an empty array when the network request throws', async () => {
    mockFetch.mockRejectedValue(new Error('Network error'));

    const results = await searchFromApi(TEST_SITE, 'query');
    expect(results).toEqual([]);
  });

  it('maps a single item without vod_play_url to an empty episodes array', async () => {
    const item = {
      vod_id: '1',
      vod_name: 'Test Movie',
      vod_pic: 'https://example.com/poster.jpg',
      vod_year: '2024',
      vod_content: 'A test movie.',
      vod_class: 'Action',
      type_name: 'Movie',
      vod_douban_id: 12345,
    };
    mockFetch.mockResolvedValue(makeApiResponse([item]));

    const results = await searchFromApi(TEST_SITE, 'test');
    expect(results).toHaveLength(1);
    expect(results[0]).toMatchObject({
      id: '1',
      title: 'Test Movie',
      poster: 'https://example.com/poster.jpg',
      year: '2024',
      source: 'test',
      source_name: 'Test Source',
      episodes: [],
    });
  });

  it('extracts m3u8 episodes from vod_play_url', async () => {
    const item = {
      vod_id: '2',
      vod_name: 'Series',
      vod_pic: '',
      vod_year: '2023',
      vod_play_url:
        'EP1$https://cdn.example.com/ep1.m3u8#EP2$https://cdn.example.com/ep2.m3u8',
    };
    mockFetch.mockResolvedValue(makeApiResponse([item]));

    const results = await searchFromApi(TEST_SITE, 'series');
    expect(results[0].episodes).toEqual([
      'https://cdn.example.com/ep1.m3u8',
      'https://cdn.example.com/ep2.m3u8',
    ]);
  });

  it('selects the $$$ partition with the most m3u8 links', async () => {
    const item = {
      vod_id: '3',
      vod_name: 'Multi-source',
      vod_pic: '',
      vod_year: '2022',
      // Second partition has 3 $-prefixed links; first has only 1 — second wins
      vod_play_url:
        '$https://a.example.com/ep1.m3u8' +
        '$$$' +
        'EP1$https://b.example.com/ep1.m3u8#EP2$https://b.example.com/ep2.m3u8#EP3$https://b.example.com/ep3.m3u8',
    };
    mockFetch.mockResolvedValue(makeApiResponse([item]));

    const results = await searchFromApi(TEST_SITE, 'multi');
    // The partition with 3 links wins
    expect(results[0].episodes).toHaveLength(3);
  });

  it('deduplicates episode URLs', async () => {
    const url = 'https://cdn.example.com/ep1.m3u8';
    const item = {
      vod_id: '4',
      vod_name: 'Dedupe',
      vod_pic: '',
      vod_play_url: `$${url}$$$$$${url}`,
    };
    mockFetch.mockResolvedValue(makeApiResponse([item]));

    const results = await searchFromApi(TEST_SITE, 'dedupe');
    expect(results[0].episodes).toEqual([url]);
  });

  it('strips parenthesised suffixes from episode URLs', async () => {
    const item = {
      vod_id: '5',
      vod_name: 'Suffix',
      vod_pic: '',
      vod_play_url: '$https://cdn.example.com/ep1.m3u8(subtitle)',
    };
    mockFetch.mockResolvedValue(makeApiResponse([item]));

    const results = await searchFromApi(TEST_SITE, 'suffix');
    expect(results[0].episodes).toEqual(['https://cdn.example.com/ep1.m3u8']);
  });

  it('trims and normalises whitespace in the title', async () => {
    const item = {
      vod_id: '6',
      vod_name: '  Hello   World  ',
      vod_pic: '',
    };
    mockFetch.mockResolvedValue(makeApiResponse([item]));

    const results = await searchFromApi(TEST_SITE, 'hello');
    expect(results[0].title).toBe('Hello World');
  });

  it('returns an empty string for year when vod_year contains no 4-digit number', async () => {
    const item = {
      vod_id: '7',
      vod_name: 'No year',
      vod_pic: '',
      vod_year: 'N/A',
    };
    mockFetch.mockResolvedValue(makeApiResponse([item]));

    const results = await searchFromApi(TEST_SITE, 'noyear');
    expect(results[0].year).toBe('');
  });

  it('returns "unknown" when vod_year is absent', async () => {
    const item = { vod_id: '8', vod_name: 'No year field', vod_pic: '' };
    mockFetch.mockResolvedValue(makeApiResponse([item]));

    const results = await searchFromApi(TEST_SITE, 'noyearfield');
    expect(results[0].year).toBe('unknown');
  });

  it('fetches config concurrently with the first page request', async () => {
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const { getConfig } = require('@/lib/config');
    const item = { vod_id: '9', vod_name: 'Concurrent', vod_pic: '' };
    mockFetch.mockResolvedValue(makeApiResponse([item]));

    await searchFromApi(TEST_SITE, 'concurrent');

    // getConfig must have been called exactly once (for the parallel fetch)
    expect(getConfig).toHaveBeenCalledTimes(1);
  });
});
