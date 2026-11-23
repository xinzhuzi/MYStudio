import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
export const sha = value => crypto.createHash('sha256').update(value).digest('hex');
export function demand(value, message) { if (!value) throw new Error(message); }
export function readArtifact(ref, research) {
  demand(ref && /^[a-f0-9]{64}$/.test(ref.sha256), 'Exact artifact hash required');
  const file = fs.realpathSync(ref.file);
  demand(file === path.resolve(ref.file) && file.startsWith(fs.realpathSync(research) + path.sep), 'Canonical task artifact required');
  const bytes = fs.readFileSync(file); demand(sha(bytes) === ref.sha256, 'Artifact hash mismatch');
  return JSON.parse(bytes.toString('utf8'));
}
export function validateFramePermit(permit, frames) {
  demand(Number.isSafeInteger(permit.maxPosts) && permit.maxPosts >= 1 && permit.maxPosts <= 3 && permit.maxSaves === permit.maxPosts, 'Exact bounded frame permit required');
  const ids = frames?.map(frame => frame.frameId);
  demand(ids?.length === permit.maxPosts && new Set(ids).size === ids.length && ids.every(id => typeof id === 'string' && id.length > 0) && frames.every(frame => frame.mediaRef.kind === 'image'), 'Permit must equal selected shot original planned slot count');
  return ids;
}
/** One selected shot, exact original frame count; failed operations never replenish a window. */
export function requestBudget(permit, now = Date.now) {
  demand(Number.isSafeInteger(permit.maxPosts) && permit.maxPosts >= 1 && permit.maxPosts <= 3 && permit.maxSaves === permit.maxPosts, 'Exact bounded frame permit required');
  demand(permit.maxRequests === 2 * permit.maxPosts, 'Request budget must be derived from one health and one POST per original frame');
  let posts = 0, requests = 0, saves = 0, phase = 'ready';
  const current = () => demand(now() <= permit.expiresAt && now() >= permit.issuedAt, 'Execution permit expired');
  return {
    request(payload) {
      current(); demand(++requests <= permit.maxRequests, 'Local request budget exhausted');
      const method = (payload.method ?? 'GET').toUpperCase();
      demand(permit.requests.some(row => row.url === payload.url && row.method === method), 'Request is outside exact local permit');
      const url = new URL(payload.url);
      demand(url.origin === 'http://127.0.0.1:17595' && !url.username && !url.password && !url.hash, 'Non-local request denied');
      if (method === 'POST') {
        demand(posts < permit.maxPosts, 'Bounded generation POST maximum; automatic retry denied');
        demand(phase === 'ready', 'Previous frame unfinished; automatic retry denied');
        posts++; phase = 'posted';
      } else demand(method === 'GET', 'Request method denied');
    },
    save() {
      current(); demand(saves < permit.maxSaves, 'Bounded pilot media save maximum');
      demand(phase === 'posted', 'One save per authorized POST required'); saves++; phase = 'saving';
    },
    saved() { current(); demand(phase === 'saving', 'No authorized save pending'); phase = 'ready'; },
    complete() { current(); demand(phase === 'ready' && posts === permit.maxPosts && saves === permit.maxSaves, 'Incomplete selected-shot frame budget'); },
    counts: () => ({ posts, requests, saves }), current,
  };
}
