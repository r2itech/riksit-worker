import { analyzeArticles } from "./lib/groq";
import { insertReport, insertSpottedInfo, isDuplicate } from "./lib/supabase";
import type { Env, RawArticle } from "./lib/types";
import { fetchGDACS } from "./sources/gdacs";
import { fetchIndonesiaNews } from "./sources/indonesia-news";

const ONE_DAY_MS = 24 * 60 * 60 * 1000;
const SPOTTED_TTL_MS = 6 * 60 * 60 * 1000;

function dedupeByUrl(articles: RawArticle[]): RawArticle[] {
	const seen = new Set<string>();
	const out: RawArticle[] = [];
	for (const a of articles) {
		const key = a.url || `${a.source}:${a.title}`;
		if (seen.has(key)) continue;
		seen.add(key);
		out.push(a);
	}
	return out;
}

function isRecent(article: RawArticle, now: number): boolean {
	if (!article.publishedAt) return true;
	const t = Date.parse(article.publishedAt);
	if (!Number.isFinite(t)) return true;
	return now - t <= ONE_DAY_MS;
}

async function settled<T>(p: Promise<T[]>): Promise<T[]> {
	try {
		return await p;
	} catch (e) {
		console.warn("[scheduled] source failed", e);
		return [];
	}
}

export default {
	async fetch(req) {
		const url = new URL(req.url);
		url.pathname = "/__scheduled";
		url.searchParams.append("cron", "* * * * *");
		return new Response(
			`To test the scheduled handler, ensure you have used the "--test-scheduled" then try running "curl ${url.href}".`,
		);
	},

	async scheduled(event, env, _ctx): Promise<void> {
		try {
			const [gn, gd] = await Promise.all([
				settled(fetchIndonesiaNews()),
				settled(fetchGDACS()),
			]);

			const all = dedupeByUrl([...gn, ...gd]);
			const now = Date.now();
			const recent = all.filter((a) => isRecent(a, now));

			console.log(
				`[scheduled] fetched=${all.length} recent=${recent.length} ` +
					`(indonesia-news=${gn.length}, gdacs=${gd.length})`,
			);

			if (!recent.length) {
				console.log(`[scheduled] no recent articles to analyze (cron=${event.cron})`);
				return;
			}

			const analyzed = await analyzeArticles(env, recent);
			const environmental = analyzed.filter((r) => r.isEnvironmental && r.message);
			console.log(`[scheduled] analyzed=${analyzed.length} environmental=${environmental.length}`);

			let insertedReports = 0;
			let insertedSpotted = 0;
			let skippedDupes = 0;

			for (const r of environmental) {
				const sourceUrl = r.sourceUrl;
				if (sourceUrl && (await isDuplicate(env, sourceUrl))) {
					skippedDupes++;
					continue;
				}
				const okReport = await insertReport(env, {
					message: r.message,
					provinceName: r.provinceName,
					regencyName: r.regencyName,
					districtName: r.districtName,
					villageName: r.villageName,
					sourceUrl,
				});
				if (okReport) insertedReports++;

				if (okReport && r.severity === "high" && sourceUrl) {
					const expiresAt = new Date(Date.now() + SPOTTED_TTL_MS).toISOString();
					const okSpotted = await insertSpottedInfo(env, {
						title: r.message.slice(0, 140),
						description: r.message,
						severity: r.severity,
						provinceName: r.provinceName,
						regencyName: r.regencyName,
						districtName: r.districtName,
						villageName: r.villageName,
						sourceUrl,
						expiresAt,
					});
					if (okSpotted) insertedSpotted++;
				}
			}

			console.log(
				`[scheduled] done cron=${event.cron} ` +
					`reports_inserted=${insertedReports} spotted_inserted=${insertedSpotted} ` +
					`duplicates_skipped=${skippedDupes}`,
			);
		} catch (e) {
			console.error("[scheduled] unhandled error", e);
		}
	},
} satisfies ExportedHandler<Env>;
