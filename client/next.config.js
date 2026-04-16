const { PHASE_DEVELOPMENT_SERVER } = require('next/constants');

module.exports = (phase) => {
  const output = process.env.NEXT_OUTPUT || 'export';

  /** @type {import('next').NextConfig} */
  const nextConfig = {
    output,
    devIndicators: false,
  };

  if (phase === PHASE_DEVELOPMENT_SERVER) {
    delete nextConfig.output;
  }

  // Add API rewrites for dev and standalone modes (not supported with static export)
  if (phase === PHASE_DEVELOPMENT_SERVER || output === 'standalone') {
    const apiUrl = process.env.API_URL || 'http://0.0.0.0:8080';
    nextConfig.rewrites = async () => [
      {
        source: '/api/config',
        destination: `${apiUrl}/api/config`,
      },
      {
        source: '/docs',
        destination: '/docs/index.html',
      },
    ];
  }

  return nextConfig;
};
