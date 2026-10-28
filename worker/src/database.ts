import type { Env } from './env';
import { Store, type DataStore } from './store';
import { SupabaseStore } from './supabase-store';

/** Firestore remains the default until the verified migration is explicitly cut over. */
export function createStore(env: Env): DataStore {
	return env.DATABASE_PROVIDER === 'supabase' ? new SupabaseStore(env) : new Store(env);
}
