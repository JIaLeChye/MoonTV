import { NextResponse } from 'next/server';

import { getCacheTime } from '@/lib/config';
import { fetchDoubanData } from '@/lib/douban';
import { DoubanItem, DoubanResult } from '@/lib/types';

interface DoubanCategoryApiResponse {
  total: number;
  items: Array<{
    id: string;
    title: string;
    card_subtitle: string;
    pic: {
      large: string;
      normal: string;
    };
    rating: {
      value: number;
    };
  }>;
}

interface JustOneApiRecentHotItem {
  id?: string | number;
  title?: string;
  name?: string;
  card_subtitle?: string;
  year?: string | number;
  cover?: string;
  poster?: string;
  pic?: {
    large?: string;
    normal?: string;
  };
  rating?:
    | string
    | number
    | {
        value?: number;
      };
  image?: string;
  cover_url?: string;
}

interface JustOneApiResponse<T> {
  code: number;
  message: string | null;
  data: T;
}

export const runtime = 'edge';

function getJustOneApiToken(): string | null {
  const token =
    process.env.JUSTONEAPI_TOKEN || process.env.NEXT_PUBLIC_JUSTONEAPI_TOKEN;
  return token && token.trim() ? token.trim() : null;
}

function getJustOneApiBaseUrl(): string {
  return (
    process.env.JUSTONEAPI_BASE_URL || 'https://api.justoneapi.com'
  ).replace(/\/$/, '');
}

function getJustOneApiRecentHotUrl(
  kind: 'movie' | 'tv',
  page: number
): string | null {
  const token = getJustOneApiToken();
  if (!token) return null;

  const endpoint =
    kind === 'movie' ? 'get-recent-hot-movie' : 'get-recent-hot-tv';

  return `${getJustOneApiBaseUrl()}/api/douban/${endpoint}/v1?token=${encodeURIComponent(
    token
  )}&page=${page}`;
}

function getJustOneApiItems(data: unknown): JustOneApiRecentHotItem[] {
  if (Array.isArray(data)) {
    return data as JustOneApiRecentHotItem[];
  }

  if (data && typeof data === 'object') {
    const payload = data as Record<string, unknown>;
    for (const key of ['items', 'list', 'records', 'data']) {
      const value = payload[key];
      if (Array.isArray(value)) {
        return value as JustOneApiRecentHotItem[];
      }
    }
  }

  return [];
}

function getJustOneApiPoster(item: JustOneApiRecentHotItem): string {
  return (
    item.pic?.normal ||
    item.pic?.large ||
    item.cover ||
    item.poster ||
    item.image ||
    item.cover_url ||
    ''
  );
}

function getJustOneApiRate(item: JustOneApiRecentHotItem): string {
  if (typeof item.rating === 'number') {
    return item.rating.toFixed(1);
  }

  if (typeof item.rating === 'string') {
    return item.rating;
  }

  if (item.rating && typeof item.rating === 'object') {
    const rating = item.rating as { value?: number };
    if (typeof rating.value === 'number') {
      return rating.value.toFixed(1);
    }
  }

  return '';
}

function mapJustOneApiItem(item: JustOneApiRecentHotItem): DoubanItem {
  return {
    id: String(item.id ?? ''),
    title: item.title || item.name || '',
    poster: getJustOneApiPoster(item),
    rate: getJustOneApiRate(item),
    year:
      item.card_subtitle?.match(/(\d{4})/)?.[1] ||
      (typeof item.year === 'number' || typeof item.year === 'string'
        ? String(item.year)
        : ''),
  };
}

async function fetchJustOneApiRecentHot(
  kind: 'movie' | 'tv',
  pageLimit: number,
  pageStart: number
): Promise<DoubanItem[]> {
  const page = Math.floor(pageStart / pageLimit) + 1;
  const target = getJustOneApiRecentHotUrl(kind, page);

  if (!target) {
    throw new Error('未配置 JUSTONEAPI_TOKEN，无法使用 JustOneAPI 兜底');
  }

  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), 10000);

  try {
    const response = await fetch(target, {
      signal: controller.signal,
      headers: {
        Accept: 'application/json, text/plain, */*',
      },
    });

    if (!response.ok) {
      throw new Error(`HTTP error! Status: ${response.status}`);
    }

    const payload = (await response.json()) as JustOneApiResponse<unknown>;

    if (payload.code !== 0) {
      throw new Error(
        payload.message || `JustOneAPI error! Code: ${payload.code}`
      );
    }

    return getJustOneApiItems(payload.data)
      .slice(0, pageLimit)
      .map(mapJustOneApiItem);
  } finally {
    clearTimeout(timeoutId);
  }
}

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);

  // 获取参数
  const kind = searchParams.get('kind') || 'movie';
  const category = searchParams.get('category');
  const type = searchParams.get('type');
  const pageLimit = parseInt(searchParams.get('limit') || '20');
  const pageStart = parseInt(searchParams.get('start') || '0');

  // 验证参数
  if (!kind || !category || !type) {
    return NextResponse.json(
      { error: '缺少必要参数: kind 或 category 或 type' },
      { status: 400 }
    );
  }

  if (!['tv', 'movie'].includes(kind)) {
    return NextResponse.json(
      { error: 'kind 参数必须是 tv 或 movie' },
      { status: 400 }
    );
  }

  if (pageLimit < 1 || pageLimit > 100) {
    return NextResponse.json(
      { error: 'pageSize 必须在 1-100 之间' },
      { status: 400 }
    );
  }

  if (pageStart < 0) {
    return NextResponse.json(
      { error: 'pageStart 不能小于 0' },
      { status: 400 }
    );
  }

  const target = `https://m.douban.com/rexxar/api/v2/subject/recent_hot/${kind}?start=${pageStart}&limit=${pageLimit}&category=${category}&type=${type}`;

  try {
    // 调用豆瓣 API
    const doubanData = await fetchDoubanData<DoubanCategoryApiResponse>(target);

    // 转换数据格式
    const list: DoubanItem[] = doubanData.items.map((item) => ({
      id: item.id,
      title: item.title,
      poster: item.pic?.normal || item.pic?.large || '',
      rate: item.rating?.value ? item.rating.value.toFixed(1) : '',
      year: item.card_subtitle?.match(/(\d{4})/)?.[1] || '',
    }));

    const response: DoubanResult = {
      code: 200,
      message: '获取成功',
      list: list,
    };

    const cacheTime = await getCacheTime();
    return NextResponse.json(response, {
      headers: {
        'Cache-Control': `public, max-age=${cacheTime}, s-maxage=${cacheTime}`,
        'CDN-Cache-Control': `public, s-maxage=${cacheTime}`,
        'Vercel-CDN-Cache-Control': `public, s-maxage=${cacheTime}`,
      },
    });
  } catch (error) {
    try {
      const fallbackList = await fetchJustOneApiRecentHot(
        kind as 'movie' | 'tv',
        pageLimit,
        pageStart
      );

      const fallbackResponse: DoubanResult = {
        code: 200,
        message: '获取成功',
        list: fallbackList,
      };

      const cacheTime = await getCacheTime();
      return NextResponse.json(fallbackResponse, {
        headers: {
          'Cache-Control': `public, max-age=${cacheTime}, s-maxage=${cacheTime}`,
          'CDN-Cache-Control': `public, s-maxage=${cacheTime}`,
          'Vercel-CDN-Cache-Control': `public, s-maxage=${cacheTime}`,
        },
      });
    } catch (fallbackError) {
      return NextResponse.json(
        {
          error: '获取豆瓣数据失败',
          details: (error as Error).message,
          fallbackDetails: (fallbackError as Error).message,
        },
        { status: 500 }
      );
    }
  }
}
