import { describe, expect, it, vi } from 'vitest';

import type { AccountDirectoryAuthenticationAction } from '@/auth/accountDirectory/accountDirectoryAuthClient';
import { getAuthProvider } from '@/auth/providers/registry';

vi.mock('@/text', async () => {
    const { createTextModuleMock } = await import('@/dev/testkit/mocks/text');
    return createTextModuleMock({ translate: (key: string) => key });
});

import { describeAccountServiceAuthenticationAction, projectAccountServiceMethodStrip } from './accountServiceAuthenticationActions';

function oauth(providerId: string, actionId: 'login' | 'provision', displayName?: string): AccountDirectoryAuthenticationAction {
    return {
        method: { id: providerId, enabledActions: [{ id: actionId, mode: 'keyless' }], ...(displayName ? { presentation: { displayName } } : {}) },
        action: { id: actionId, mode: 'keyless' },
        execution: { kind: 'oauth', providerId, mode: 'keyless' },
    };
}
const keyLogin: AccountDirectoryAuthenticationAction = {
    method: { id: 'key_challenge', enabledActions: [{ id: 'login', mode: 'keyed' }] },
    action: { id: 'login', mode: 'keyed' },
    execution: { kind: 'key_entry' },
};
const keyCreate: AccountDirectoryAuthenticationAction = {
    method: { id: 'key_challenge', enabledActions: [{ id: 'provision', mode: 'keyed' }] },
    action: { id: 'provision', mode: 'keyed' },
    execution: { kind: 'generated_key' },
};

const emailLogin: AccountDirectoryAuthenticationAction = {
    method: { id: 'email_password', enabledActions: [{ id: 'login', mode: 'either' }] },
    action: { id: 'login', mode: 'either' },
    execution: { kind: 'email_password', action: 'login', mode: 'either' },
};
const emailCreate: AccountDirectoryAuthenticationAction = {
    method: { id: 'email_password', enabledActions: [{ id: 'provision', mode: 'keyed' }] },
    action: { id: 'provision', mode: 'keyed' },
    execution: { kind: 'email_password', action: 'provision', mode: 'keyed' },
};

describe('account-service sign-in methods', () => {
    it('offers one button per way in, the first OAuth sign-in first, and account creation as the quiet action', () => {
        const githubCreate = oauth('github', 'provision');
        const githubLogin = oauth('github', 'login');
        const strip = projectAccountServiceMethodStrip([keyCreate, keyLogin, githubCreate, githubLogin]);

        expect(strip.primary).toBe(githubLogin);
        expect(strip.secondary).toEqual([keyLogin]);
        expect(strip.overflow).toEqual([]);
        expect(strip.create).toBe(keyCreate);
    });

    it('makes the key the primary way in when the service offers no OAuth provider', () => {
        const strip = projectAccountServiceMethodStrip([keyLogin, keyCreate]);

        expect(strip.primary).toBe(keyLogin);
        expect(strip.secondary).toEqual([]);
        expect(strip.create).toBe(keyCreate);
    });

    it('moves every way in past the primary behind "more ways" when more than three are offered', () => {
        const okta = oauth('okta', 'login', 'Acme SSO');
        const github = oauth('github', 'login');
        const workos = oauth('workos', 'login', 'WorkOS');
        const strip = projectAccountServiceMethodStrip([keyLogin, okta, github, workos]);

        expect(strip.primary).toBe(okta);
        expect(strip.secondary).toEqual([]);
        expect(strip.overflow).toEqual([keyLogin, github, workos]);
    });

    it('puts email and password before a key when there is no OAuth, and creates accounts by email when offered', () => {
        const strip = projectAccountServiceMethodStrip([keyLogin, keyCreate, emailLogin, emailCreate]);

        expect(strip.primary).toBe(emailLogin);
        expect(strip.secondary).toEqual([keyLogin]);
        expect(strip.create).toBe(emailCreate);
        // OAuth stays the primary way in; email and password is then a secondary one.
        const github = oauth('github', 'login');
        expect(projectAccountServiceMethodStrip([emailLogin, github]).primary).toBe(github);
    });

    it('names email creation as an email journey, not as a generated key', () => {
        const presentation = describeAccountServiceAuthenticationAction(emailCreate, 'Acme Accounts');

        expect(presentation.title).toBe('settingsAccount.nativePassword.createAccount');
        expect(presentation.subtitle).toBe('Acme Accounts');
        expect(presentation.iconName).toBe('envelope');
    });

    it('marks an OAuth provider with its registered brand glyph', () => {
        const presentation = describeAccountServiceAuthenticationAction(oauth('github', 'login'), 'Happier Cloud');

        expect(presentation.title).toBe('welcome.signUpWithProvider');
        const registeredGlyph = getAuthProvider('github')?.badgeIconName;
        expect(registeredGlyph).toBeTruthy();
        expect(presentation.iconName).toBe(registeredGlyph);
    });
});
