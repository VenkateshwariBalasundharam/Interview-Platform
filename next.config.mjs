/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  poweredByHeader: false,
  // Resume parsers use Node-only code, so keep them out of the webpack bundle.
  serverExternalPackages: ['pdf-parse', 'mammoth', 'read-excel-file'],
  // face-api bundles TensorFlow, which mentions Node's fs behind a runtime check; the browser build never needs it.
  webpack: (config, { isServer }) => {
    if (!isServer) config.resolve.fallback = { ...config.resolve.fallback, fs: false, path: false };
    return config;
  },
  async headers() {
    return [
      {
        source: '/:path*',
        headers: [
          { key: 'X-Content-Type-Options', value: 'nosniff' },
          { key: 'X-Frame-Options', value: 'DENY' },
          { key: 'Referrer-Policy', value: 'same-origin' },
          // Camera is needed by the proctored rounds (Phase 7); everything else is off.
          { key: 'Permissions-Policy', value: 'camera=(self), microphone=(), geolocation=()' },
        ],
      },
    ];
  },
};

export default nextConfig;
