/**
 * apps/web/src/app/sitemap.ts
 * Public pages only. Set NEXT_PUBLIC_APP_ORIGIN to the production domain.
 */
import type { MetadataRoute } from 'next';

export default function sitemap(): MetadataRoute.Sitemap {
  const origin = (process.env.NEXT_PUBLIC_APP_ORIGIN ?? 'http://localhost:3000').replace(/\/+$/, '');
  return [
    { url: `${origin}/`, changeFrequency: 'weekly', priority: 1 },
    { url: `${origin}/pricing`, changeFrequency: 'monthly', priority: 0.8 },
    { url: `${origin}/legal/terms`, changeFrequency: 'yearly', priority: 0.2 },
    { url: `${origin}/legal/privacy`, changeFrequency: 'yearly', priority: 0.2 },
    { url: `${origin}/legal/refund`, changeFrequency: 'yearly', priority: 0.2 },
  ];
}
