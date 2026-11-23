import { withPayload } from "@payloadcms/next/withPayload";
export default withPayload({
  experimental: {
    // Next.js proxy clones upload requests. Its 10MB default truncates larger
    // WAV/M4A multipart bodies before /api/assets can parse them.
    // Audio files remain capped at 70 MiB by validateFile and 71 MiB (including multipart) by boundedBody.
    proxyClientMaxBodySize: "72mb",
  },
});
