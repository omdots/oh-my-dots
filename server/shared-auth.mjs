import * as oidc from 'openid-client';
import { randomBytes, timingSafeEqual } from 'node:crypto';
import { createOmdProvider } from './omd-provider.mjs';

const clientId = 'oh-my-dots';
const prefix = '/api/auth/omd';
const loginPath = '/login';
const flowTTL = 5 * 60_000;

export function createSharedAuth({ issuer, secret, mcpResource, origin, accounts, setSession }) {
  const issuerUrl = new URL(issuer);
  const loopback = issuerUrl.protocol === 'http:' && ['127.0.0.1', 'localhost', '[::1]'].includes(issuerUrl.hostname);
  if ((!loopback && issuerUrl.protocol !== 'https:') || issuerUrl.href !== issuerUrl.origin + '/' || !secret) {
    throw Error('Configure a shared Auth origin and web client secret.');
  }
  const secure = origin.startsWith('https:');
  const cookieName = secure ? '__Host-dots_oidc' : 'dots_oidc';
  const flowCookie = (value, age) => `${cookieName}=${value}; Path=/; Max-Age=${age}; HttpOnly; SameSite=Lax${secure ? '; Secure' : ''}`;
  const redirectUri = origin + prefix + '/callback';
  const flows = new Map();
  let discovery;
  function discover() {
    discovery ??= oidc.discovery(issuerUrl, clientId, undefined, oidc.ClientSecretBasic(secret),
      { execute: loopback ? [oidc.allowInsecureRequests] : [], timeout: 5 })
      .catch(error => { discovery = undefined; throw error; });
    return discovery;
  }
  const provider = mcpResource && createOmdProvider({ resource: mcpResource, secret, issuer: issuerUrl.origin, accounts, discover });
  const resourceParameter = provider ? { resource: provider.resource } : {};
  const redirect = (res, path) => res.writeHead(303, { Location: path }).end();

  const handle = async (req, res, url, user, sessionToken) => {
    if (req.method !== 'GET' || ![prefix, prefix + '/link', prefix + '/callback'].includes(url.pathname)) return false;
    const now = Date.now();
    for (const [state, flow] of flows) if (flow.expires <= now) flows.delete(state);
    try {
      if (url.pathname === prefix + '/callback') {
        const state = url.searchParams.get('state');
        const flow = flows.get(state);
        const cookie = (req.headers.cookie || '').split(';').map(value => value.trim())
          .find(value => value.startsWith(cookieName + '='))?.slice(cookieName.length + 1);
        if (!flow || !cookie || cookie.length !== flow.browser.length ||
            !timingSafeEqual(Buffer.from(cookie), Buffer.from(flow.browser))) throw Error('Invalid login flow');
        flows.delete(state);
        res.setHeader('Set-Cookie', flowCookie('', 0));
        if (flow.userId && (user?.id !== flow.userId || sessionToken !== flow.sessionToken)) throw Error('Local session changed');
        const config = await discover();
        const tokens = await oidc.authorizationCodeGrant(config, url, {
          expectedState: state, expectedNonce: flow.nonce, pkceCodeVerifier: flow.verifier, idTokenExpected: true,
        }, resourceParameter);
        const subject = tokens.claims()?.sub;
        if (!subject) throw Error('Missing subject');
        if (flow.userId) {
          accounts.linkIdentity(issuerUrl.origin, subject, flow.userId);
          provider?.save(flow.userId, tokens);
          return redirect(res, '/original/webview/');
        }
        const account = accounts.identityUser(issuerUrl.origin, subject);
        if (!account) return redirect(res, loginPath + '?omd=unlinked');
        provider?.save(account.id, tokens);
        setSession(res, account.id, sessionToken);
        return redirect(res, '/original/webview/');
      }

      const link = url.pathname.endsWith('/link');
      if (link && (!user || ![undefined, 'none', 'same-origin'].includes(req.headers['sec-fetch-site']))) return redirect(res, loginPath);
      if (!link && user) return redirect(res, '/original/webview/');
      if (flows.size >= 1000) throw Error('Too many sign-in requests');
      const config = await discover();
      const verifier = oidc.randomPKCECodeVerifier();
      const state = oidc.randomState();
      const nonce = oidc.randomNonce();
      const browser = randomBytes(32).toString('hex');
      flows.set(state, { verifier, nonce, browser, expires: now + flowTTL, userId: link ? user.id : undefined, sessionToken });
      const authorization = oidc.buildAuthorizationUrl(config, {
        redirect_uri: redirectUri, scope: provider ? 'openid profile mcp:read' : 'openid profile', response_type: 'code', state, nonce,
        ...resourceParameter,
        code_challenge: await oidc.calculatePKCECodeChallenge(verifier), code_challenge_method: 'S256',
      });
      res.setHeader('Set-Cookie', flowCookie(browser, flowTTL / 1000));
      return redirect(res, authorization.href);
    } catch {
      return redirect(res, loginPath + '?omd=error');
    }
  };
  return { handle, provider, linked: userId => accounts.identityLinked(issuerUrl.origin, userId) };
}
