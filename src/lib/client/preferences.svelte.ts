export type Theme = 'light' | 'dark';

// Test-only controls are visible locally or in an explicitly marked test build.
export const isTestEnv = import.meta.env.DEV || import.meta.env.VITE_APP_ENV === 'test';

export const preferences = $state({ theme: 'light' as Theme, testView: isTestEnv });

function read(key: string): string | null {
	try {
		return localStorage.getItem(key);
	} catch {
		return null;
	}
}
function write(key: string, value: string) {
	try {
		localStorage.setItem(key, value);
	} catch {
		/* Preferences are a convenience; private mode simply forgets them. */
	}
}

export function initPreferences() {
	preferences.theme = document.documentElement.dataset.theme === 'dark' ? 'dark' : 'light';
	preferences.testView = isTestEnv && read('lunchroom-test-view') !== 'prod';
}
export function setTheme(theme: Theme) {
	preferences.theme = theme;
	document.documentElement.dataset.theme = theme;
	write('lunchroom-theme', theme);
}
export function setTestView(testView: boolean) {
	preferences.testView = isTestEnv && testView;
	write('lunchroom-test-view', testView ? 'test' : 'prod');
}
