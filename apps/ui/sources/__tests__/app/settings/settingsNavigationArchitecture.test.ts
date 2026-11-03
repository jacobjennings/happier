import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';

import { describe, expect, it } from 'vitest';

const UI_SOURCES_ROOT = join(__dirname, '..', '..', '..');
const APP_ROUTES_ROOT = join(UI_SOURCES_ROOT, 'app', '(app)');
const SETTINGS_ROUTES_ROOT = join(APP_ROUTES_ROOT, 'settings');

const ALLOWED_SETTINGS_STACK_SCREEN_FILES = new Set([
    'app/(app)/settings/_layout.tsx',
    'components/settings/actions/ActionSettingsDetailView.tsx',
    'components/settings/plugins/PluginSettingsPageScreen.tsx',
]);

/** Chrome read from the registry: stack screen definitions, or the active route's registered title. */
const REGISTRY_DRIVEN_CHROME_PATTERN = /\b(?:getSettingsStackScreenDefinitions|resolveSettingsRouteTitleKey)\(/;

function walkFiles(root: string): string[] {
    return readdirSync(root)
        .flatMap((entry) => {
            const fullPath = join(root, entry);
            const stats = statSync(fullPath);
            if (stats.isDirectory()) return walkFiles(fullPath);
            return stats.isFile() ? [fullPath] : [];
        });
}

function toRelativeUiPath(fullPath: string): string {
    return relative(UI_SOURCES_ROOT, fullPath).replaceAll('\\', '/');
}

describe('settings navigation architecture', () => {
    it('keeps settings sub-routes out of the root stack', () => {
        const appLayout = readFileSync(join(APP_ROUTES_ROOT, '_layout.tsx'), 'utf8');
        expect(appLayout).not.toMatch(/name=["']settings\/[^"']+["']/);
    });

    it('keeps settings screens from declaring their own static Stack.Screen chrome', () => {
        const violations = [
            ...walkFiles(SETTINGS_ROUTES_ROOT),
            ...walkFiles(join(UI_SOURCES_ROOT, 'components', 'settings')),
        ]
            .filter((fullPath) => fullPath.endsWith('.tsx'))
            .map((fullPath) => ({
                relativePath: toRelativeUiPath(fullPath),
                contents: readFileSync(fullPath, 'utf8'),
            }))
            .filter(({ relativePath }) => !ALLOWED_SETTINGS_STACK_SCREEN_FILES.has(relativePath))
            .filter(({ contents }) => /<Stack\.Screen\b/.test(contents))
            // A nested navigator layout registers its screens (or follows the active route's title) from the
            // settings route registry itself, so its chrome stays centralized.
            .filter(({ contents }) => !REGISTRY_DRIVEN_CHROME_PATTERN.test(contents))
            .map(({ relativePath }) => relativePath)
            .sort();

        expect(violations).toEqual([]);
    });
});
