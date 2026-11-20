import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const app = await readFile(new URL('../src/App.tsx', import.meta.url), 'utf8');
const entry = await readFile(new URL('../src/main.tsx', import.meta.url), 'utf8');
const authGate = await readFile(new URL('../src/components/AuthGate.tsx', import.meta.url), 'utf8');

assert.doesNotMatch(app, /import\s+\{?\s*AuthGate\s*\}?\s+from/);
assert.doesNotMatch(app, /if\s*\(\s*!isAuthenticated\s*\|\|\s*!auth\.session\s*\)\s*return\s*<AuthGate/);
assert.match(app, /writeAssessmentDraft\(\{\s*challengeId,\s*candidate,\s*answer\s*\}\)/, 'legacy assessment drafts remain saved for signed-out visitors');
assert.match(entry, /<AuthProvider><App \/><\/AuthProvider>/, 'Supabase auth provider stays available for future use');
assert.match(authGate, /requestOtp|verifyOtp/i, 'OTP implementation remains in the codebase');

console.log('MVP access regression checks passed: public app entry, guest draft persistence, and preserved OTP infrastructure.');
