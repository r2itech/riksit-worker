import type { Env } from "./types";

function lower(v: string | null | undefined): string | null {
	if (v === null || v === undefined) return null;
	const s = String(v).trim();
	if (!s) return null;
	return s.toLowerCase();
}

function headers(env: Env, extra: Record<string, string> = {}): Record<string, string> {
	return {
		apikey: env.SUPABASE_ANON_KEY,
		Authorization: `Bearer ${env.SUPABASE_ANON_KEY}`,
		"Content-Type": "application/json",
		Prefer: "return=minimal",
		...extra,
	};
}

export interface ReportInsert {
	message: string;
	provinceName?: string | null;
	regencyName?: string | null;
	districtName?: string | null;
	villageName?: string | null;
	sourceUrl?: string | null;
}

export interface SpottedInfoInsert {
	title: string;
	description: string;
	severity: "high" | "medium";
	provinceName?: string | null;
	regencyName?: string | null;
	districtName?: string | null;
	villageName?: string | null;
	sourceUrl: string;
	expiresAt: string;
}

export async function insertReport(env: Env, data: ReportInsert): Promise<boolean> {
	try {
		const body = {
			username: "Riksit Agent",
			is_ai: true,
			message: data.message,
			province_name: lower(data.provinceName),
			regency_name: lower(data.regencyName),
			district_name: lower(data.districtName),
			village_name: lower(data.villageName),
			source_url: data.sourceUrl ?? null,
		};
		const res = await fetch(`${env.SUPABASE_URL}/reports`, {
			method: "POST",
			headers: headers(env),
			body: JSON.stringify(body),
		});
		if (!res.ok) {
			const text = await res.text().catch(() => "");
			console.warn(`[supabase] insertReport failed ${res.status}: ${text}`);
			return false;
		}
		return true;
	} catch (e) {
		console.warn("[supabase] insertReport error", e);
		return false;
	}
}

export async function insertSpottedInfo(env: Env, data: SpottedInfoInsert): Promise<boolean> {
	try {
		const body = {
			title: data.title,
			description: data.description,
			severity: data.severity,
			province_name: lower(data.provinceName),
			regency_name: lower(data.regencyName),
			district_name: lower(data.districtName),
			village_name: lower(data.villageName),
			source_url: data.sourceUrl,
			expires_at: data.expiresAt,
		};
		const res = await fetch(`${env.SUPABASE_URL}/spotted_info`, {
			method: "POST",
			headers: headers(env),
			body: JSON.stringify(body),
		});
		if (!res.ok) {
			const text = await res.text().catch(() => "");
			console.warn(`[supabase] insertSpottedInfo failed ${res.status}: ${text}`);
			return false;
		}
		return true;
	} catch (e) {
		console.warn("[supabase] insertSpottedInfo error", e);
		return false;
	}
}

export async function isDuplicate(env: Env, sourceUrl: string): Promise<boolean> {
	if (!sourceUrl) return false;
	try {
		const cutoff = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
		const url =
			`${env.SUPABASE_URL}/reports` +
			`?select=id` +
			`&source_url=eq.${encodeURIComponent(sourceUrl)}` +
			`&created_at=gte.${encodeURIComponent(cutoff)}` +
			`&limit=1`;
		const res = await fetch(url, {
			method: "GET",
			headers: {
				apikey: env.SUPABASE_ANON_KEY,
				Authorization: `Bearer ${env.SUPABASE_ANON_KEY}`,
				Accept: "application/json",
			},
		});
		if (!res.ok) {
			console.warn(`[supabase] isDuplicate failed ${res.status}`);
			return false;
		}
		const rows = (await res.json().catch(() => [])) as unknown;
		return Array.isArray(rows) && rows.length > 0;
	} catch (e) {
		console.warn("[supabase] isDuplicate error", e);
		return false;
	}
}
