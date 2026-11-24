/**
 * The origin for links sent to customers. `APP_URL` pins it to the canonical site, so a
 * reservation made on a deploy preview (which shares the production database) or through a
 * spoofed `Host` header still gets a production link. Local development falls back to the
 * request's own origin.
 */
export const getPublicOrigin = (request: Request): string => {
    const appUrl = process.env.APP_URL?.trim();
    return appUrl ? new URL(appUrl).origin : new URL(request.url).origin;
};
