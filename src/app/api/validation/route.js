import { NextResponse } from 'next/server';

// RoshRegression's credentials, as measured — never as claimed.
// Written by `npm run eval:sweep` (holdout: paired exact McNemar, BCa bootstrap CIs).
// If the model gets worse, this endpoint says so and the dashboard shows it.
export async function GET() {
  try {
    const v = (await import('@/data/validation.json')).default;
    return NextResponse.json(v);
  } catch {
    // No sweep has been run yet — the UI simply hides the section rather than
    // inventing credentials for a model nobody has tested.
    return NextResponse.json({ available: false }, { status: 200 });
  }
}
