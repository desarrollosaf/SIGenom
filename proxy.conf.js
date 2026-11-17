const backendHost = process.env.BACKEND_HOST || 'localhost';
const backendPort = process.env.BACKEND_PORT || '3080';

module.exports = {
  '/api': {
    target: `http://${backendHost}:${backendPort}`,
    pathRewrite: { '^/api': '' },
    changeOrigin: true,
  },
};
