import { parseRSS } from "../lib/parser";
import type { RawArticle } from "../lib/types";

interface FeedConfig {
	url: string;
	source: string;
}

const FEEDS: FeedConfig[] = [
	{ url: "https://www.antaranews.com/rss/top-news", source: "antara" },
	{ url: "https://www.mongabay.co.id/feed/", source: "mongabay" },
	{ url: "https://www.cnnindonesia.com/nasional/rss", source: "cnn-indonesia" },
	{ url: "https://feed.liputan6.com/rss/news", source: "liputan6" },
	{ url: "https://tirto.id/sitemap/r/google-discover", source: "tirto" },
	{ url: "https://www.republika.co.id/rss/nasional/", source: "republika" },
];

const MAX_ARTICLES = 30;

const HEADERS: Record<string, string> = {
	"User-Agent": "RIKSIT Environmental Monitor (riksit.vercel.app)",
};

function tsOf(article: RawArticle): number {
	const t = Date.parse(article.publishedAt);
	return Number.isFinite(t) ? t : 0;
}

async function fetchOne(feed: FeedConfig): Promise<RawArticle[]> {
	try {
		const res = await fetch(feed.url, { headers: HEADERS });
		if (res.status >= 400) {
			console.warn(`[indonesia-news] ${res.status} for ${feed.source} (${feed.url})`);
			return [];
		}
		const xml = await res.text();
		return parseRSS(xml, feed.source);
	} catch (e) {
		console.warn(`[indonesia-news] fetch failed for ${feed.source} (${feed.url})`, e);
		return [];
	}
}

export async function fetchIndonesiaNews(): Promise<RawArticle[]> {
	const perFeed = await Promise.all(FEEDS.map(fetchOne));
	const seen = new Set<string>();
	const collected: RawArticle[] = [];
	for (const items of perFeed) {
		for (const it of items) {
			if (!it.url || seen.has(it.url)) continue;
			seen.add(it.url);
			collected.push(it);
		}
	}
	collected.sort((a, b) => tsOf(b) - tsOf(a));
	return collected.slice(0, MAX_ARTICLES);
}
