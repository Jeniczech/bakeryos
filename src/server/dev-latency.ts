/**
 * Waits `DEV_LATENCY_MS` in development to imitate the hosted round trip (~200 ms or more on
 * Netlify), which local responses hide. Does nothing in production builds.
 */
export const simulateDevLatency = async (): Promise<void> => {
    if (process.env.NODE_ENV !== 'development') return;
    const delayMs = Number(process.env.DEV_LATENCY_MS);
    if (Number.isFinite(delayMs) && delayMs > 0) {
        await new Promise((resolve) => setTimeout(resolve, delayMs));
    }
};
