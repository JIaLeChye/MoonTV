import { checkForUpdates, CURRENT_VERSION, UpdateStatus } from '@/lib/version';

const mockFetch = jest.fn();
global.fetch = mockFetch;

function makeFetchResponse(text: string, ok = true) {
  return Promise.resolve({
    ok,
    text: () => Promise.resolve(text),
    status: ok ? 200 : 404,
  });
}

describe('checkForUpdates', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    jest.useFakeTimers();
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  it('returns HAS_UPDATE when the remote version is newer', async () => {
    const newer = String(parseInt(CURRENT_VERSION, 10) + 1);
    mockFetch.mockResolvedValue(makeFetchResponse(newer));

    const result = await checkForUpdates();
    expect(result).toBe(UpdateStatus.HAS_UPDATE);
  });

  it('returns NO_UPDATE when the remote version equals the current version', async () => {
    mockFetch.mockResolvedValue(makeFetchResponse(CURRENT_VERSION));

    const result = await checkForUpdates();
    expect(result).toBe(UpdateStatus.NO_UPDATE);
  });

  it('returns NO_UPDATE when the remote version is older', async () => {
    const older = String(parseInt(CURRENT_VERSION, 10) - 1);
    mockFetch.mockResolvedValue(makeFetchResponse(older));

    const result = await checkForUpdates();
    expect(result).toBe(UpdateStatus.NO_UPDATE);
  });

  it('returns FETCH_FAILED when all URLs fail', async () => {
    mockFetch.mockRejectedValue(new Error('Network error'));

    const result = await checkForUpdates();
    expect(result).toBe(UpdateStatus.FETCH_FAILED);
  });

  it('returns FETCH_FAILED when all URLs return non-ok responses', async () => {
    mockFetch.mockResolvedValue(makeFetchResponse('', false));

    const result = await checkForUpdates();
    expect(result).toBe(UpdateStatus.FETCH_FAILED);
  });

  it('succeeds using the backup URL when the primary URL fails', async () => {
    const newer = String(parseInt(CURRENT_VERSION, 10) + 1);
    mockFetch
      .mockRejectedValueOnce(new Error('Primary URL unreachable'))
      .mockResolvedValueOnce(makeFetchResponse(newer));

    const result = await checkForUpdates();
    expect(result).toBe(UpdateStatus.HAS_UPDATE);
  });

  it('initiates requests to both URLs concurrently', async () => {
    mockFetch.mockResolvedValue(makeFetchResponse(CURRENT_VERSION));

    await checkForUpdates();

    // Both URLs should have been called
    expect(mockFetch).toHaveBeenCalledTimes(2);
  });
});
