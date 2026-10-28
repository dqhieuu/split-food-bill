import type { DurableObjectNamespace, R2Bucket, Hyperdrive } from '@cloudflare/workers-types';
export interface Env {
	APP_ENV: 'local' | 'production';
	FRONTEND_ORIGIN: string;
	DATABASE_PROVIDER?: 'firestore' | 'supabase';
	SUPABASE_DATABASE_URL?: string;
	SUPABASE_DB_CA?: string;
	/** Cloudflare-managed connection pool with verified TLS to Supabase. */
	SUPABASE_DB?: Hyperdrive;
	/** Temporarily reject database traffic during the verified data copy/cutover. */
	DATABASE_MAINTENANCE?: string;
	FIREBASE_PROJECT_ID: string;
	FIREBASE_API_KEY: string;
	FIREBASE_AUTH_DOMAIN: string;
	FIRESTORE_EMULATOR_HOST?: string;
	FIREBASE_AUTH_EMULATOR_HOST?: string;
	FIREBASE_CLIENT_EMAIL?: string;
	FIREBASE_PRIVATE_KEY?: string;
	DISCORD_CLIENT_ID?: string;
	DISCORD_CLIENT_SECRET?: string;
	DISCORD_BOT_TOKEN?: string;
	DISCORD_ADMIN_IDS?: string;
	DISCORD_GUILD_IDS?: string;
	AUTH_SESSIONS: DurableObjectNamespace;
	/** Receipt photos; optional so the ledger keeps working before the bucket is provisioned. */
	BILL_IMAGES?: R2Bucket;
}
export function isLocal(env: Env) {
	return env.APP_ENV === 'local';
}
export function assertEnvironment(env: Env, request: Request) {
	if (env.DATABASE_PROVIDER && !['firestore', 'supabase'].includes(env.DATABASE_PROVIDER))
		throw new Error('Unknown database provider.');
	if (env.DATABASE_PROVIDER === 'supabase' && !env.SUPABASE_DATABASE_URL && !env.SUPABASE_DB)
		throw new Error('Supabase database connection is not configured.');
	if (isLocal(env)) {
		if (
			!['127.0.0.1', 'localhost'].includes(new URL(request.url).hostname) ||
			env.FIREBASE_PROJECT_ID !== 'demo-lunchroom' ||
			env.FIRESTORE_EMULATOR_HOST !== '127.0.0.1:8080' ||
			env.FIREBASE_AUTH_EMULATOR_HOST !== '127.0.0.1:9099'
		)
			throw new Error('Local mocks require loopback hosts and the demo Firebase project.');
	} else if (
		env.APP_ENV !== 'production' ||
		env.FIRESTORE_EMULATOR_HOST ||
		env.FIREBASE_AUTH_EMULATOR_HOST ||
		env.FIREBASE_PROJECT_ID === 'demo-lunchroom' ||
		env.FIREBASE_PROJECT_ID.startsWith('configure-') ||
		!env.FIREBASE_API_KEY ||
		env.FIREBASE_API_KEY.startsWith('configure-') ||
		!env.FIREBASE_AUTH_DOMAIN ||
		env.FIREBASE_AUTH_DOMAIN.startsWith('configure-') ||
		env.FRONTEND_ORIGIN.includes('.invalid') ||
		!env.FRONTEND_ORIGIN.startsWith('https://') ||
		!env.FIREBASE_CLIENT_EMAIL ||
		!env.FIREBASE_PRIVATE_KEY ||
		!env.DISCORD_CLIENT_ID ||
		!env.DISCORD_CLIENT_SECRET ||
		!env.DISCORD_BOT_TOKEN
	) {
		throw new Error('Production services are not fully configured.');
	}
}
