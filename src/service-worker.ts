/// <reference no-default-lib="true"/>
/// <reference lib="esnext" />
/// <reference lib="webworker" />
/// <reference types="@sveltejs/kit" />
import { assets, immutable } from '$app/manifest';
import { version } from '$app/env';

const sw = self as unknown as ServiceWorkerGlobalScope;
const CACHE = `cache-${version}`;
/** Manifest paths are relative to the base path, which is the service worker's scope. */
const scoped = (path: string) => new URL(path, sw.registration.scope).pathname;
/** The app is client-rendered, so one cached shell can open any route offline. */
const SHELL = scoped('');
const IMMUTABLE = new Set([...immutable, ...assets].map(({ path }) => scoped(path)));
const COURT_ASSETS = [...IMMUTABLE].filter((path) => path.startsWith(scoped('models/court/')));
const PRECACHE = [...IMMUTABLE].filter((path) => !path.startsWith(scoped('models/court/')));

sw.addEventListener('install', (event) => {
	event.waitUntil(caches.open(CACHE).then((cache) => cache.addAll([...PRECACHE, SHELL])));
});

// Warm the optional court only after a model has loaded. This also covers the
// first visit, before the new service worker controls the page's model requests.
sw.addEventListener('message', (event) => {
	if (event.data?.type === 'cache-court') {
		event.waitUntil(caches.open(CACHE).then((cache) => cache.addAll(COURT_ASSETS)));
	}
});

async function cacheFirst(request: Request) {
	const cache = await caches.open(CACHE);
	const cached = await cache.match(request);
	if (cached) return cached;
	const response = await fetch(request);
	if (response.ok && response.type === 'basic') await cache.put(request, response.clone());
	return response;
}

sw.addEventListener('activate', (event) => {
	event.waitUntil(
		caches
			.keys()
			.then((keys) => Promise.all(keys.filter((key) => key !== CACHE).map((key) => caches.delete(key))))
	);
});

/** Network first so deploys show up immediately; the cache only answers when offline. */
async function networkFirst(request: Request) {
	const cache = await caches.open(CACHE);
	const key = request.mode === 'navigate' ? SHELL : request;
	try {
		const response = await fetch(request);
		if (response.ok && response.type === 'basic') await cache.put(key, response.clone());
		return response;
	} catch (error) {
		const cached = await cache.match(key);
		if (cached) return cached;
		throw error;
	}
}

sw.addEventListener('fetch', (event) => {
	const { request } = event;
	const url = new URL(request.url);
	// API calls go cross-origin with a bearer token and must always reach the network.
	if (request.method !== 'GET' || url.origin !== sw.location.origin) return;
	if (IMMUTABLE.has(url.pathname)) {
		event.respondWith(cacheFirst(request));
		return;
	}
	event.respondWith(networkFirst(request));
});
