/** Shared maximum: admission, browser, private R2 and migration must agree.
 * Lower runtime upload limits never make existing verified objects unreadable. */
export const PROJECT_VIDEO_MAX_MIB=250;
export const PROJECT_VIDEO_MAX_BYTES=PROJECT_VIDEO_MAX_MIB*1024*1024;
export const PROJECT_LEGACY_MULTIPART_MAX_BYTES=50*1024*1024;
