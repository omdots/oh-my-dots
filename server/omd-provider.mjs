import { createCipheriv, createDecipheriv, hkdfSync, randomBytes } from 'node:crypto';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import * as oidc from 'openid-client';

export function createOmdProvider({ resource, secret, issuer, accounts, discover }) {
  const url = new URL(resource);
  const local = url.protocol === 'http:' && ['127.0.0.1', 'localhost', '[::1]'].includes(url.hostname);
  if ((!local && url.protocol !== 'https:') || url.pathname !== '/mcp' || url.href !== url.origin + '/mcp') {
    throw Error('DOTS_MCP_URL must be an HTTPS or loopback HTTP /mcp URL.');
  }
  const key = hkdfSync('sha256', secret, '', 'oh-my-dots-provider-token', 32);
  const refreshes = new Map();

  function save(userId, tokens, previousRefresh) {
    if (!tokens.refresh_token && !previousRefresh) throw Error('The MCP grant is missing a refresh token');
    const grant = {
      access: tokens.access_token, refresh: tokens.refresh_token || previousRefresh,
      expires: Date.now() + (tokens.expires_in || 0) * 1000,
    };
    const iv = randomBytes(12);
    const cipher = createCipheriv('aes-256-gcm', key, iv);
    cipher.setAAD(Buffer.from(issuer + '\n' + userId));
    const encrypted = Buffer.concat([cipher.update(JSON.stringify(grant)), cipher.final()]);
    accounts.saveProviderGrant(issuer, userId, Buffer.concat([iv, cipher.getAuthTag(), encrypted]).toString('base64'));
    return grant.access;
  }

  function read(userId) {
    const stored = accounts.providerGrant(issuer, userId);
    if (!stored) throw Error('계정 설정에서 OhMyDots 계정을 연결하세요.');
    try {
      const bytes = Buffer.from(stored, 'base64');
      const decipher = createDecipheriv('aes-256-gcm', key, bytes.subarray(0, 12));
      decipher.setAAD(Buffer.from(issuer + '\n' + userId));
      decipher.setAuthTag(bytes.subarray(12, 28));
      return JSON.parse(Buffer.concat([decipher.update(bytes.subarray(28)), decipher.final()]));
    } catch {
      throw Error('OhMyDots 계정으로 다시 로그인해 Provider 연결을 갱신하세요.');
    }
  }

  async function getAccess(userId, rejectedAccess) {
    if (refreshes.has(userId)) return refreshes.get(userId);
    const grant = read(userId);
    if (grant.access !== rejectedAccess && grant.expires > Date.now() + 5000) return grant.access;
    const refresh = (async () => {
      try {
        const tokens = await oidc.refreshTokenGrant(await discover(), grant.refresh, { resource });
        // A newer browser sign-in might have installed another grant while refreshing.
        const current = read(userId);
        return current.refresh !== grant.refresh ? current.access : save(userId, tokens, grant.refresh);
      } catch {
        const current = read(userId);
        if (current.refresh !== grant.refresh) return current.access;
        throw Error('Provider 인증을 갱신하지 못했습니다. OhMyDots 계정으로 다시 로그인해 주세요.');
      } finally {
        refreshes.delete(userId);
      }
    })();
    refreshes.set(userId, refresh);
    return refresh;
  }

  async function call(userId, name, args, signal) {
    async function send(token) {
      const client = new Client({ name: 'oh-my-dots', version: '0.1.0' });
      const transport = new StreamableHTTPClientTransport(url, { requestInit: { headers: { Authorization: 'Bearer ' + token }, redirect: 'error' } });
      try {
        await client.connect(transport, { signal, timeout: 5000 });
        const result = await client.callTool({ name, arguments: args }, undefined, { signal, timeout: 15000 });
        if (result.isError) throw Error(result.content?.find(item => item.type === 'text')?.text || 'Provider tool failed.');
        return result.structuredContent;
      } finally {
        await client.close();
      }
    }
    const token = await getAccess(userId);
    try { return await send(token); }
    catch (error) {
      if (error.code !== 401) throw error;
      return send(await getAccess(userId, token));
    }
  }

  return { resource, save, call, connected: userId => Boolean(accounts.providerGrant(issuer, userId)) };
}
