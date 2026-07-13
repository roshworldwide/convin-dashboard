'use client';

/* The internal dashboard. Same component as the shared view (`/r/<token>`), with no
   share token — so the session, the date navigator, the upload tabs and the Account
   Explorer are all switched on. See Report.jsx. */
import Report from './Report';

export default function Page() {
  return <Report />;
}
