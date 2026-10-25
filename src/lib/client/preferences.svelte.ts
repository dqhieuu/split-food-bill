export type Theme = 'light' | 'dark';

// Every deployment currently runs against the local Firebase emulators; set VITE_APP_ENV=production to opt out.
export const isTestEnv = (import.meta.env.VITE_APP_ENV ?? 'test') !== 'production';

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
