/**
 * apps/web/src/app/robots.ts
 * Only the public marketing pages are crawlable. App screens, APIs and guest share links
 * (which contain private documents) are excluded; /s/ pages also send noindex.
 */
import type { MetadataRoute } from 'next';

export default function robots(): MetadataRoute.Robots {
  const origin = process.env.NEXT_PUBLIC_APP_ORIGIN?.replace(/\/+$/, '');
  return {
    rules: [
      {
        userAgent: '*',
        allow: ['/', '/pricing', '/legal/'],
        disallow: ['/s/', '/api/', '/login', '/today', '/inbox', '/projects', '/calendar', '/search', '/tax', '/settings'],
      },
    ],
    ...(origin ? { sitemap: `${origin}/sitemap.xml` } : {}),
  };
}
