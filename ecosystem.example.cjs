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
      PORT: '3001',
      // Payment: WeChat Pay v3
      WECHAT_PAY_APP_ID: '',
      WECHAT_PAY_MCH_ID: '',
      WECHAT_PAY_API_V3_KEY: '',
      WECHAT_PAY_PRIVATE_KEY: '',
      WECHAT_PAY_CERT_SERIAL: '',
      WECHAT_PAY_NOTIFY_URL: 'https://yooclaw.yookeer.com/api/v1/pay/notify/wechat',
      // SMTP for email delivery (invoice, briefing, etc.)
      SMTP_HOST: 'smtp.mxhichina.com',
      SMTP_PORT: '465',
      SMTP_USER: 'your-email@example.com',
      SMTP_PASS: 'your-smtp-password',
    }
  }]
};
