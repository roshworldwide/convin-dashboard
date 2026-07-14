import { NextResponse } from 'next/server';
import { PAYLOAD_VERSION } from '../../../lib/payload_version.mjs';

export const dynamic = 'force-dynamic';

/* ─────────────────────────────────────────────────────────────────────────────
 * WHICH CODE IS ACTUALLY RUNNING?
 *
 * We lost hours to this. Commits were pushed, GitHub had them, `npm run build`
 * passed — and the deployed dashboard kept serving old wording. There was no way to
 * ask the running server "what are you?", so every diagnosis was a guess: stale
 * browser cache? failed build? wrong branch? un-linked Git integration?
 *
 * A deployed app that cannot state its own version is a deployed app you cannot
 * debug. So it states it. No auth: it returns a commit SHA and two integers, and
 * nothing here is a secret — but being able to run
 *
 *     curl https://<app>/api/version
 *
 * and get a straight answer is worth more than the theoretical value of hiding it.
 * ───────────────────────────────────────────────────────────────────────────── */
export async function GET() {
  return NextResponse.json({
    payloadVersion: PAYLOAD_VERSION,
    // Vercel injects these at build time. Locally they are simply absent.
    commit: process.env.VERCEL_GIT_COMMIT_SHA?.slice(0, 7) || 'local',
    branch: process.env.VERCEL_GIT_COMMIT_REF || 'local',
    message: process.env.VERCEL_GIT_COMMIT_MESSAGE?.split('\n')[0] || '',
    env: process.env.VERCEL_ENV || 'development',
    // If this is missing, DATABASE_URL never reached the runtime — the single most
    // likely way this deployment fails silently, and it shows an empty dashboard
    // rather than an error.
    database: process.env.DATABASE_URL ? 'connected' : 'NOT SET',
  });
}
