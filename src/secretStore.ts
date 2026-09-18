/**
 * Secure storage for provider API keys.
 *
 * Zotero runs on Gecko, so use the browser login manager instead of writing
 * secrets into prefs.js. The login manager stores credentials in the profile's
 * encrypted login store (logins.json/key4.db on current Zotero builds).
 * Node/test and older restricted preview contexts return unavailable and let
 * callers decide whether to keep a legacy value for compatibility.
 */

export type SecretProvider = 'deepseek' | 'gemini';

export interface SecureApiKeys {
  available: boolean;
  deepseekApiKey: string;
  geminiApiKey: string;
}

const LOGIN_ORIGIN = 'chrome://zotero-academic-translator';
const LOGIN_REALM = 'Zotero Academic Translator API Key';
const LOGIN_USERNAME_PREFIX = 'provider:';

function getLoginManager(): any | null {
  const globals = globalThis as any;
  const chromeUtils = globals.ChromeUtils;

  try {
    if (typeof chromeUtils?.importESModule === 'function') {
      const servicesModule = chromeUtils.importESModule('resource://gre/modules/Services.sys.mjs');
      const manager = servicesModule?.Services?.logins || servicesModule?.logins;
      if (manager) return manager;
    }
  } catch (_) {}

  try {
    if (typeof chromeUtils?.import === 'function') {
      const servicesModule = chromeUtils.import('resource://gre/modules/Services.jsm');
      const manager = servicesModule?.Services?.logins || servicesModule?.logins;
      if (manager) return manager;
    }
  } catch (_) {}

  return globals.Services?.logins || null;
}

function getLoginInfo(origin: string, realm: string, username: string, password: string): any | null {
  const globals = globalThis as any;
  const components = globals.Components;
  const classes = components?.classes || globals.Cc;
  const interfaces = components?.interfaces || globals.Ci;
  const factory = classes?.['@mozilla.org/login-manager/loginInfo;1'];

  try {
    const info = factory?.createInstance?.(interfaces?.nsILoginInfo);
    if (info?.init) {
      info.init(origin, null, realm, username, password, '', '');
      return info;
    }
  } catch (_) {}

  try {
    const Constructor = components?.Constructor;
    if (typeof Constructor === 'function') {
      const LoginInfo = Constructor(
        '@mozilla.org/login-manager/loginInfo;1',
        'nsILoginInfo',
        'init'
      );
      return new LoginInfo(origin, null, realm, username, password, '', '');
    }
  } catch (_) {}

  return null;
}

function usernameFor(provider: SecretProvider): string {
  return `${LOGIN_USERNAME_PREFIX}${provider}`;
}

function providerFromUsername(username: unknown): SecretProvider | null {
  if (username === usernameFor('deepseek')) return 'deepseek';
  if (username === usernameFor('gemini')) return 'gemini';
  return null;
}

function findLogins(manager: any): any[] {
  if (typeof manager?.findLogins !== 'function') return [];
  const logins = manager.findLogins({}, LOGIN_ORIGIN, null, LOGIN_REALM);
  if (Array.isArray(logins)) return logins;
  // Older Gecko/Zotero builds can expose an array-like XPCOM collection.
  try {
    return logins && typeof logins.length === 'number' ? Array.from(logins) : [];
  } catch (_) {
    return [];
  }
}

/** Read both provider keys without ever logging their values. */
export function readSecureApiKeys(): SecureApiKeys {
  const manager = getLoginManager();
  if (!manager) {
    return { available: false, deepseekApiKey: '', geminiApiKey: '' };
  }

  try {
    const result: SecureApiKeys = {
      available: true,
      deepseekApiKey: '',
      geminiApiKey: '',
    };
    for (const login of findLogins(manager)) {
      const provider = providerFromUsername(login?.username);
      if (!provider || typeof login?.password !== 'string') continue;
      if (provider === 'deepseek') result.deepseekApiKey = login.password.trim();
      if (provider === 'gemini') result.geminiApiKey = login.password.trim();
    }
    return result;
  } catch (_) {
    return { available: false, deepseekApiKey: '', geminiApiKey: '' };
  }
}

/** Replace both provider credentials in one controlled operation. */
export function writeSecureApiKeys(keys: Pick<SecureApiKeys, 'deepseekApiKey' | 'geminiApiKey'>): boolean {
  const manager = getLoginManager();
  if (!manager || typeof manager.addLogin !== 'function' || typeof manager.removeLogin !== 'function') {
    return false;
  }

  try {
    const logins = findLogins(manager);
    for (const login of logins) {
      if (providerFromUsername(login?.username)) manager.removeLogin(login);
    }

    for (const provider of ['deepseek', 'gemini'] as const) {
      const key = String(keys[`${provider}ApiKey`] || '').trim();
      if (!key) continue;
      const login = getLoginInfo(
        LOGIN_ORIGIN,
        LOGIN_REALM,
        usernameFor(provider),
        key
      );
      if (!login) return false;
      manager.addLogin(login);
    }
    return true;
  } catch (_) {
    return false;
  }
}

export function isSecureApiKeyStoreAvailable(): boolean {
  return readSecureApiKeys().available;
}
