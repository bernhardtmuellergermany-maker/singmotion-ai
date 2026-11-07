import { withPayload } from "@payloadcms/next/withPayload";
export default withPayload({
  experimental: {
    // Next.js proxy clones upload requests. Its 10MB default truncates larger
    // WAV/M4A multipart bodies before /api/assets can parse them.
    // Files remain capped at 50MB by validateFile and 51MB by boundedBody.
    proxyClientMaxBodySize: "52mb",
  },
});
