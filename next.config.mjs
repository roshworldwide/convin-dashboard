import { BASE_PATH } from './src/lib/basepath.mjs';

/** @type {import('next').NextConfig} */
const nextConfig = {
  /* Serve the entire app under a deep, unguessable path on the public domain.
     The bare domain root is left to 404 so nothing is exposed on the main site.
     See src/lib/basepath.mjs — change the path there, not here. */
  basePath: BASE_PATH,

  /* Belt-and-braces: never let this be indexed by search engines, on top of the
     robots metadata in layout.js. Applies to every app route (Next prepends the
     basePath to the source pattern automatically). */
  async headers() {
    return [
      {
        source: '/:path*',
        headers: [{ key: 'X-Robots-Tag', value: 'noindex, nofollow, noarchive' }],
      },
    ];
  },
};

export default nextConfig;
