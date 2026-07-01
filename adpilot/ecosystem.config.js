module.exports = {
  apps: [
    {
      name: "adpilot",
      script: "./dist/index.cjs",
      instances: 1,
      exec_mode: "cluster",
      env: {
        NODE_ENV: "production",
        PORT: 3000,
      },
      error_file: "./logs/err.log",
      out_file: "./logs/out.log",
      log_date_format: "YYYY-MM-DD HH:mm:ss Z",
      merge_logs: true,
      max_memory_restart: "500M",

      // Restart on file changes (for development)
      watch: false,
      ignore_watch: ["node_modules", "dist", "logs"],

      // Crash recovery
      autorestart: true,
      max_restarts: 10,
      min_uptime: "10s",

      // Graceful shutdown
      listen_timeout: 3000,
      kill_timeout: 5000,
      wait_ready: true,
    },
  ],

  deploy: {
    production: {
      user: "ubuntu",
      host: "your-vps-ip-or-domain",
      ref: "origin/main",
      repo: "https://github.com/leads-digitalmojo/AdCortex.git",
      path: "/home/ubuntu/apps/AdCortex",
      "post-deploy": "npm ci && npm run build && pm2 reload ecosystem.config.js --env production",
      "pre-deploy-local": "echo 'Deploying to production...'",
    },
  },
};
