import type { NextConfig } from 'next';

const nextConfig: NextConfig = {
    agentRules: false,
    cacheComponents: true,
    partialPrefetching: true,
    experimental: {
        // Dev only: the instant-validation worker reports a false "Client Component in a parent
        // segment prevented the page from rendering" for `/`. Validation still runs, in-process.
        // https://github.com/vercel/next.js/issues/98393
        devValidationWorker: false,
    },
    turbopack: {
        rules: {
            '*.css': {
                loaders: ['@tailwindcss/turbopack'],
                as: '*.css',
            },
        },
    },
};

export default nextConfig;
