export interface RawArticle {
	title: string;
	description: string;
	url: string;
	publishedAt: string;
	source: string;
}

export type Severity = "high" | "medium";

export interface AnalyzedReport {
	message: string;
	provinceName: string | null;
	regencyName: string | null;
	districtName: string | null;
	villageName: string | null;
	isEnvironmental: boolean;
	severity: Severity;
	sourceUrl: string;
}

export interface Env {
	GROQ_API_KEY: string;
	SUPABASE_URL: string;
	SUPABASE_ANON_KEY: string;
	ENVIRONMENT: string;
}
