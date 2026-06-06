import { parseRSS } from "../lib/parser";
import type { RawArticle } from "../lib/types";

const FEEDS: string[] = [
	"https://news.google.com/rss/search?q=sampah+Indonesia&hl=id&gl=ID&ceid=ID:id",
	"https://news.google.com/rss/search?q=polusi+udara+Indonesia&hl=id&gl=ID&ceid=ID:id",
	"https://news.google.com/rss/search?q=banjir+Indonesia&hl=id&gl=ID&ceid=ID:id",
	"https://news.google.com/rss/search?q=kebakaran+hutan+Indonesia&hl=id&gl=ID&ceid=ID:id",
	"https://news.google.com/rss/search?q=pencemaran+lingkungan+Indonesia&hl=id&gl=ID&ceid=ID:id",
];

const MAX_ARTICLES = 30;

const BROWSER_HEADERS: Record<string, string> = {
	"User-Agent":
		"Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
	Accept: "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
	"Accept-Language": "id-ID,id;q=0.9,en-US;q=0.8",
	"Accept-Encoding": "gzip, deflate, br",
	"Cache-Control": "no-cache",
};

function tsOf(article: RawArticle): number {
	const t = Date.parse(article.publishedAt);
	return Number.isFinite(t) ? t : 0;
}

export async function fetchGoogleNews(): Promise<RawArticle[]> {
	const collected: RawArticle[] = [];
	const seen = new Set<string>();
	for (const url of FEEDS) {
		try {
			const res = await fetch(url, { headers: BROWSER_HEADERS });
			if (!res.ok) {
				console.warn(`[google-news] ${res.status} for ${url}`);
				continue;
			}
			const xml = await res.text();
			const items = parseRSS(xml, "google-news");
			for (const it of items) {
				if (!it.url || seen.has(it.url)) continue;
				seen.add(it.url);
				collected.push(it);
			}
		} catch (e) {
			console.warn(`[google-news] fetch failed for ${url}`, e);
		}
	}
	collected.sort((a, b) => tsOf(b) - tsOf(a));
	return collected.slice(0, MAX_ARTICLES);
}
