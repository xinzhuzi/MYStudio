// Task-bundle-only import substitution, never a global dispatcher/fetch patch.
import { Agent, fetch as undiciFetch } from 'undici';
export { Agent };
export function fetch(input, init) {
  return undiciFetch(input, { ...init, redirect:'error' });
}
