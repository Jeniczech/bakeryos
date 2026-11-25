import type { NextConfig } from 'next';

const nextConfig: NextConfig = {
    agentRules: false,
    cacheComponents: true,
    partialPrefetching: true,
    // A redirect in a page fails Cache Components' instant-navigation validation.
    redirects: async () => [
        { source: '/admin', destination: '/admin/reservations', permanent: false },
    ],
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
