/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  // ssh2 ships native bindings that webpack can't bundle; keep it (and the SFTP
  // client that wraps it) as a runtime require in server code.
  // exiftool-vendored spawns a bundled binary; webpack must not inline it or the
  // binary path resolution breaks in the serverless bundle.
  serverExternalPackages: ['ssh2', 'ssh2-sftp-client', 'exiftool-vendored'],
};

export default nextConfig;
