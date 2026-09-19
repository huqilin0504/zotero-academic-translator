
export type SecretProvider = 'deepseek' | 'gemini';

export interface SecureApiKeys {
  available: boolean;
  deepseekApiKey: string;
  geminiApiKey: string;
}

const LOGIN_ORIGIN = 'chrome://zotero-academic-translator';
const LOGIN_REALM = 'Zotero Academic Translator API Key';
const LOGIN_USERNAME_PREFIX = 'provider:';

const EMPTY_SECURE_KEYS: SecureApiKeys = {
  available: false,
  deepseekApiKey: '',
  geminiApiKey: '',
};

function getLoginManager(): any | null {
  const globals = globalThis as any;
  const chromeUtils = globals.ChromeUtils || (typeof ChromeUtils !== 'undefined' ? ChromeUtils : null);

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

  const services = globals.Services || (typeof Services !== 'undefined' ? Services : null);
  return services?.logins || null;
}

function getLoginInfo(origin: string, realm: string, username: string, password: string): any | null {
  const globals = globalThis as any;
  const components = globals.Components;
  const classes = components?.classes || globals.Cc || (typeof Cc !== 'undefined' ? Cc : null);
  const interfaces = components?.interfaces || globals.Ci || (typeof Ci !== 'undefined' ? Ci : null);
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

function toLoginArray(logins: unknown): any[] {
  if (Array.isArray(logins)) return logins;
  try {
    return logins && typeof (logins as any).length === 'number'
      ? Array.from(logins as ArrayLike<any>)
      : [];
  } catch (_) {
    return [];
  }
}

function findLogins(manager: any): any[] {
  if (typeof manager?.findLogins !== 'function') return [];
  const logins = !manager.searchLoginsAsync && manager.findLogins.length >= 4
    ? manager.findLogins({}, LOGIN_ORIGIN, null, LOGIN_REALM)
    : manager.findLogins(LOGIN_ORIGIN, null, LOGIN_REALM);
  return toLoginArray(logins);
}

async function findLoginsAsync(manager: any): Promise<any[]> {
  if (typeof manager?.searchLoginsAsync === 'function') {
    const logins = await manager.searchLoginsAsync({
      origin: LOGIN_ORIGIN,
      httpRealm: LOGIN_REALM,
    });
    return toLoginArray(logins);
  }
  return findLogins(manager);
}

export function readSecureApiKeys(): SecureApiKeys {
  const manager = getLoginManager();
  if (!manager) return { ...EMPTY_SECURE_KEYS };

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
    return { ...EMPTY_SECURE_KEYS };
  }
}

export async function readSecureApiKeysAsync(): Promise<SecureApiKeys> {
  const manager = getLoginManager();
  if (!manager) return { ...EMPTY_SECURE_KEYS };

  try {
    const result: SecureApiKeys = {
      available: true,
      deepseekApiKey: '',
      geminiApiKey: '',
    };
    for (const login of await findLoginsAsync(manager)) {
      const provider = providerFromUsername(login?.username);
      if (!provider || typeof login?.password !== 'string') continue;
      if (provider === 'deepseek') result.deepseekApiKey = login.password.trim();
      if (provider === 'gemini') result.geminiApiKey = login.password.trim();
    }
    return result;
  } catch (_) {
    return { ...EMPTY_SECURE_KEYS };
  }
}

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

export async function writeSecureApiKeysAsync(
  keys: Pick<SecureApiKeys, 'deepseekApiKey' | 'geminiApiKey'>
): Promise<boolean> {
  const manager = getLoginManager();
  if (!manager) return false;

  const addLogin = typeof manager.addLoginAsync === 'function'
    ? manager.addLoginAsync.bind(manager)
    : typeof manager.addLogin === 'function'
      ? manager.addLogin.bind(manager)
      : null;
  const removeLogin = typeof manager.removeLoginAsync === 'function'
    ? manager.removeLoginAsync.bind(manager)
    : typeof manager.removeLogin === 'function'
      ? manager.removeLogin.bind(manager)
      : null;
  if (!addLogin || !removeLogin) return false;

  try {
    const newLogins: any[] = [];
    for (const provider of ['deepseek', 'gemini'] as const) {
      const key = String(keys[`${provider}ApiKey`] || '').trim();
      if (!key) continue;
      const login = getLoginInfo(LOGIN_ORIGIN, LOGIN_REALM, usernameFor(provider), key);
      if (!login) return false;
      newLogins.push(login);
    }

    for (const login of await findLoginsAsync(manager)) {
      if (providerFromUsername(login?.username)) await removeLogin(login);
    }
    for (const login of newLogins) await addLogin(login);
    return true;
  } catch (_) {
    return false;
  }
}

export function isSecureApiKeyStoreAvailable(): boolean {
  return readSecureApiKeys().available;
}
