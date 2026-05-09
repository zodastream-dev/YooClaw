module.exports = {
  apps: [{
    name: 'yooclaw-api',
    script: './server/index.ts',
    interpreter: 'npx',
    interpreter_args: 'tsx',
    cwd: '/opt/YooClaw',
    env: {
      JWT_SECRET: 'your-jwt-secret-here',
      DATABASE_URL: 'postgresql://user:pass@host:6543/db?sslmode=require',
      CODEBUDDY_API_KEY: 'your-codebuddy-api-key',
      CODEBUDDY_INTERNET_ENVIRONMENT: 'internal',
      FRONTEND_URL: 'https://your-domain.com',
      PORT: '3001'
    }
  }]
};
