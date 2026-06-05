import type { AnalyzedReport, Env, RawArticle, Severity } from './types';

const GROQ_URL = 'https://api.groq.com/openai/v1/chat/completions';
const MODELS = ['llama-3.3-70b-versatile', 'llama-3.1-8b-instant'] as const;
const MAX_RETRIES = 2;
const BATCH_SIZE = 5;
const MAX_TITLE_LEN = 100;
const MAX_DESCRIPTION_LEN = 300;

function truncate(s: string, max: number): string {
	if (s.length <= max) return s;
	return `${s.slice(0, max)}...`;
}

function sleep(ms: number): Promise<void> {
	return new Promise((r) => setTimeout(r, ms));
}

function buildPrompt(articles: RawArticle[]): string {
	const payload = articles.map((a) => ({
		title: truncate(a.title, MAX_TITLE_LEN),
		description: truncate(a.description, MAX_DESCRIPTION_LEN),
		url: a.url,
		publishedAt: a.publishedAt,
		source: a.source,
	}));
	return [
		'Kamu adalah analis lingkungan untuk platform RIKSIT yang fokus pada isu',
		'Clean City di Indonesia. Analisis artikel berikut dan untuk setiap artikel',
		'tentukan:',
		'',
		'1. Apakah artikel ini berkaitan dengan isu lingkungan (sampah, polusi,',
		'   banjir, kebakaran, kerusakan lingkungan)? (isEnvironmental: true/false)',
		'',
		'   PENTING: Hanya tandai isEnvironmental: true untuk isu yang terjadi di',
		'   Indonesia. Isu dari negara lain harus selalu isEnvironmental: false.',
		'   Artinya, isu lingkungan dari Amerika Serikat, Australia, Eropa, atau',
		'   negara lain di luar Indonesia harus diberi isEnvironmental: false',
		'   meskipun topiknya relevan.',
		'',
		'2. Jika ya, buat ringkasan laporan singkat dalam Bahasa Indonesia (1-2 kalimat)',
		'3. Tentukan tingkat keparahan: "high" (darurat, butuh perhatian segera) atau',
		'   "medium" (perlu perhatian tapi tidak darurat)',
		'4. Ekstrak lokasi yang disebutkan: provinsi, kabupaten/kota, kecamatan, desa',
		'   (gunakan null jika tidak disebutkan)',
		'',
		'Kembalikan HANYA JSON array, tanpa preamble atau markdown:',
		'[',
		'  {',
		'    "isEnvironmental": boolean,',
		'    "message": "ringkasan laporan",',
		'    "severity": "high" | "medium",',
		'    "provinceName": string | null,',
		'    "regencyName": string | null,',
		'    "districtName": string | null,',
		'    "villageName": string | null,',
		'    "sourceUrl": string',
		'  }',
		']',
		'',
		'Artikel:',
		JSON.stringify(payload, null, 2),
	].join('\n');
}

function isRetryable(status: number): boolean {
	return status === 408 || status === 429 || (status >= 500 && status < 600);
}

async function callGroq(env: Env, model: string, prompt: string): Promise<string | null> {
	const body = {
		model,
		messages: [{ role: 'user', content: prompt }],
		temperature: 0.2,
		response_format: { type: 'json_object' as const },
	};
	for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
		try {
			const res = await fetch(GROQ_URL, {
				method: 'POST',
				headers: {
					Authorization: `Bearer ${env.GROQ_API_KEY}`,
					'Content-Type': 'application/json',
				},
				body: JSON.stringify(body),
			});
			if (res.ok) {
				const data = (await res.json().catch(() => null)) as { choices?: Array<{ message?: { content?: string } }> } | null;
				const content = data?.choices?.[0]?.message?.content;
				return typeof content === 'string' ? content : null;
			}
			if (!isRetryable(res.status)) {
				const t = await res.text().catch(() => '');
				console.warn(`[groq] non-retryable ${res.status} on ${model}: ${t}`);
				return null;
			}
			if (attempt === MAX_RETRIES) {
				console.warn(`[groq] gave up after ${MAX_RETRIES + 1} attempts on ${model} (status ${res.status})`);
				return null;
			}
			await sleep(500 * Math.pow(2, attempt));
		} catch (e) {
			if (attempt === MAX_RETRIES) {
				console.warn(`[groq] network error on ${model}:`, e);
				return null;
			}
			await sleep(500 * Math.pow(2, attempt));
		}
	}
	return null;
}

function extractJsonArray(raw: string): unknown[] | null {
	if (!raw) return null;
	const trimmed = raw.trim();
	const tryParse = (s: string): unknown => {
		try {
			return JSON.parse(s);
		} catch {
			return undefined;
		}
	};
	let parsed: unknown = tryParse(trimmed);
	if (Array.isArray(parsed)) return parsed;
	if (parsed && typeof parsed === 'object') {
		for (const v of Object.values(parsed as Record<string, unknown>)) {
			if (Array.isArray(v)) return v;
		}
	}
	const first = trimmed.indexOf('[');
	const last = trimmed.lastIndexOf(']');
	if (first !== -1 && last > first) {
		parsed = tryParse(trimmed.slice(first, last + 1));
		if (Array.isArray(parsed)) return parsed;
	}
	return null;
}

function normalizeReport(item: unknown, fallbackUrl: string): AnalyzedReport | null {
	if (!item || typeof item !== 'object') return null;
	const r = item as Record<string, unknown>;
	const isEnv = r.isEnvironmental === true;
	const message = typeof r.message === 'string' ? r.message : '';
	const sev = r.severity === 'high' || r.severity === 'medium' ? (r.severity as Severity) : 'medium';
	const str = (v: unknown): string | null => (typeof v === 'string' && v.trim() ? v : null);
	const sourceUrl = typeof r.sourceUrl === 'string' && r.sourceUrl ? r.sourceUrl : fallbackUrl;
	return {
		isEnvironmental: isEnv,
		message,
		severity: sev,
		provinceName: str(r.provinceName),
		regencyName: str(r.regencyName),
		districtName: str(r.districtName),
		villageName: str(r.villageName),
		sourceUrl,
	};
}

async function analyzeBatch(env: Env, batch: RawArticle[]): Promise<AnalyzedReport[]> {
	const prompt = buildPrompt(batch);
	let raw: string | null = null;
	for (const model of MODELS) {
		raw = await callGroq(env, model, prompt);
		if (raw) break;
	}
	if (!raw) return [];
	const arr = extractJsonArray(raw);
	if (!arr) {
		console.warn('[groq] failed to parse JSON array from response');
		return [];
	}
	const out: AnalyzedReport[] = [];
	for (let i = 0; i < arr.length; i++) {
		const fallback = batch[i]?.url ?? '';
		const norm = normalizeReport(arr[i], fallback);
		if (norm) out.push(norm);
	}
	return out;
}

export async function analyzeArticles(env: Env, articles: RawArticle[]): Promise<AnalyzedReport[]> {
	if (!articles.length) return [];
	const results: AnalyzedReport[] = [];
	for (let i = 0; i < articles.length; i += BATCH_SIZE) {
		const batch = articles.slice(i, i + BATCH_SIZE);
		const part = await analyzeBatch(env, batch);
		results.push(...part);
		if (i + BATCH_SIZE < articles.length) {
			await sleep(3000);
		}
	}
	return results;
}
