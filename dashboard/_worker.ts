import app from './functions/api/[[catchall]]';
import { getAssetFromKV } from '@cloudflare/kv-asset-handler';

interface Env {
  __STATIC_CONTENT: KVNamespace;
  __STATIC_CONTENT_MANIFEST: string;
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);

    // Handle API routes
    if (url.pathname.startsWith('/api/')) {
      return app.fetch(request, env as any);
    }

    // Serve static assets for everything else
    try {
      return await getAssetFromKV(request, {
        ASSET_NAMESPACE: env.__STATIC_CONTENT,
        ASSET_MANIFEST: JSON.parse(env.__STATIC_CONTENT_MANIFEST),
      });
    } catch (e) {
      // Fallback to index.html for SPA routing
      return await getAssetFromKV(new Request(new URL('/index.html', request.url)), {
        ASSET_NAMESPACE: env.__STATIC_CONTENT,
        ASSET_MANIFEST: JSON.parse(env.__STATIC_CONTENT_MANIFEST),
      });
    }
  },
};