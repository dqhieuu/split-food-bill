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

sw.addEventListener('install', (event) => {
	event.waitUntil(caches.open(CACHE).then((cache) => cache.addAll([...IMMUTABLE, SHELL])));
});

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
		event.respondWith(caches.match(url.pathname).then((cached) => cached ?? fetch(request)));
		return;
	}
	event.respondWith(networkFirst(request));
});
