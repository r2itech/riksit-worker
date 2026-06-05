import type { RawArticle } from "./types";

const ITEM_RE = /<item\b[^>]*>([\s\S]*?)<\/item>/gi;

function decodeEntities(s: string): string {
	return s
		.replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, "$1")
		.replace(/&lt;/g, "<")
		.replace(/&gt;/g, ">")
		.replace(/&quot;/g, '"')
		.replace(/&#39;/g, "'")
		.replace(/&apos;/g, "'")
		.replace(/&nbsp;/g, " ")
		.replace(/&#(\d+);/g, (_, n) => String.fromCharCode(parseInt(n, 10)))
		.replace(/&#x([0-9a-fA-F]+);/g, (_, h) => String.fromCharCode(parseInt(h, 16)))
		.replace(/&amp;/g, "&");
}

function stripTags(s: string): string {
	return s.replace(/<[^>]+>/g, "").replace(/\s+/g, " ").trim();
}

function extractTag(block: string, tag: string): string {
	const re = new RegExp(`<${tag}\\b[^>]*>([\\s\\S]*?)<\\/${tag}>`, "i");
	const m = block.match(re);
	if (!m) return "";
	return decodeEntities(stripTags(m[1])).trim();
}

export function parseRSS(xml: string, source = "rss"): RawArticle[] {
	if (!xml || typeof xml !== "string") return [];
	const out: RawArticle[] = [];
	try {
		const matches = xml.match(ITEM_RE);
		if (!matches) return [];
		for (const block of matches) {
			const title = extractTag(block, "title");
			const description = extractTag(block, "description");
			const url = extractTag(block, "link");
			const publishedAt = extractTag(block, "pubDate");
			if (!title && !url) continue;
			out.push({
				title,
				description,
				url,
				publishedAt,
				source,
			});
		}
	} catch {
		return [];
	}
	return out;
}
