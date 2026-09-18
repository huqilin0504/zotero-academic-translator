import test from 'node:test';
import assert from 'node:assert/strict';
import {
  readSecureApiKeys,
  readSecureApiKeysAsync,
  writeSecureApiKeys,
  writeSecureApiKeysAsync,
} from '../src/secretStore';

test('secret store: 普通 Node 测试环境不会把密钥当作可持久化存储', () => {
  const result = readSecureApiKeys();
  assert.equal(result.available, false);
  assert.equal(result.deepseekApiKey, '');
  assert.equal(result.geminiApiKey, '');
  assert.equal(writeSecureApiKeys({ deepseekApiKey: 'test-key', geminiApiKey: '' }), false);
});

test('secret store: Zotero 登录管理器按供应商分开保存并可清空', () => {
  const globals = globalThis as any;
  const oldServices = globals.Services;
  const oldComponents = globals.Components;
  const logins: any[] = [];
  globals.Services = {
    logins: {
      findLogins: () => logins.slice(),
      addLogin: (login: any) => logins.push(login),
      removeLogin: (login: any) => {
        const index = logins.indexOf(login);
        if (index >= 0) logins.splice(index, 1);
      },
    },
  };
  globals.Components = {
    classes: {
      '@mozilla.org/login-manager/loginInfo;1': {
        createInstance: () => ({
          init(origin: string, _form: unknown, realm: string, username: string, password: string) {
            Object.assign(this, { origin, realm, username, password });
          },
        }),
      },
    },
    interfaces: { nsILoginInfo: {} },
  };

  try {
    assert.equal(writeSecureApiKeys({ deepseekApiKey: 'deepseek-test', geminiApiKey: 'gemini-test' }), true);
    assert.deepEqual(readSecureApiKeys(), {
      available: true,
      deepseekApiKey: 'deepseek-test',
      geminiApiKey: 'gemini-test',
    });
    assert.equal(writeSecureApiKeys({ deepseekApiKey: '', geminiApiKey: '' }), true);
    assert.deepEqual(readSecureApiKeys(), {
      available: true,
      deepseekApiKey: '',
      geminiApiKey: '',
    });
  } finally {
    if (oldServices === undefined) delete globals.Services;
    else globals.Services = oldServices;
    if (oldComponents === undefined) delete globals.Components;
    else globals.Components = oldComponents;
  }
});

test('secret store: Zotero 7 异步登录管理器可以保存 API Key', async () => {
  const globals = globalThis as any;
  const oldServices = globals.Services;
  const oldComponents = globals.Components;
  const logins: any[] = [];
  globals.Services = {
    logins: {
      findLogins: (origin: string, formActionOrigin: unknown, httpRealm: string) => {
        assert.equal(origin, 'chrome://zotero-academic-translator');
        assert.equal(formActionOrigin, null);
        assert.equal(httpRealm, 'Zotero Academic Translator API Key');
        return logins.slice();
      },
      searchLoginsAsync: async ({ origin, httpRealm }: any) => {
        assert.equal(origin, 'chrome://zotero-academic-translator');
        assert.equal(httpRealm, 'Zotero Academic Translator API Key');
        return logins.slice();
      },
      addLoginAsync: async (login: any) => {
        logins.push(login);
        return login;
      },
      removeLogin: (login: any) => {
        const index = logins.indexOf(login);
        if (index >= 0) logins.splice(index, 1);
      },
    },
  };
  globals.Components = {
    classes: {
      '@mozilla.org/login-manager/loginInfo;1': {
        createInstance: () => ({
          init(origin: string, _form: unknown, realm: string, username: string, password: string) {
            Object.assign(this, { origin, realm, username, password });
          },
        }),
      },
    },
    interfaces: { nsILoginInfo: {} },
  };

  try {
    assert.equal(await writeSecureApiKeysAsync({
      deepseekApiKey: 'deepseek-async-test',
      geminiApiKey: 'gemini-async-test',
    }), true);
    assert.deepEqual(await readSecureApiKeysAsync(), {
      available: true,
      deepseekApiKey: 'deepseek-async-test',
      geminiApiKey: 'gemini-async-test',
    });
    assert.deepEqual(readSecureApiKeys(), {
      available: true,
      deepseekApiKey: 'deepseek-async-test',
      geminiApiKey: 'gemini-async-test',
    });
    assert.deepEqual(logins.map(login => login.username), ['provider:deepseek', 'provider:gemini']);
    assert.equal(await writeSecureApiKeysAsync({ deepseekApiKey: '', geminiApiKey: '' }), true);
    assert.equal(logins.length, 0);
  } finally {
    if (oldServices === undefined) delete globals.Services;
    else globals.Services = oldServices;
    if (oldComponents === undefined) delete globals.Components;
    else globals.Components = oldComponents;
  }
});
