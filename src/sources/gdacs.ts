import { parseRSS } from "../lib/parser";
import type { RawArticle } from "../lib/types";

const FEED_URL = "https://www.gdacs.org/xml/rss.xml";
const MAX_ARTICLES = 10;

export async function fetchGDACS(): Promise<RawArticle[]> {
	try {
		const res = await fetch(FEED_URL, {
			headers: { "User-Agent": "Mozilla/5.0 RiksitWorker/1.0" },
		});
		if (!res.ok) {
			console.warn(`[gdacs] ${res.status}`);
			return [];
		}
		const xml = await res.text();
		const items = parseRSS(xml, "gdacs");
		const filtered = items.filter((it) => {
			const hay = `${it.title} ${it.description}`.toLowerCase();
			return hay.includes("indonesia");
		});
		return filtered.slice(0, MAX_ARTICLES);
	} catch (e) {
		console.warn("[gdacs] fetch failed", e);
		return [];
	}
}
