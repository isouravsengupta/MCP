module.exports = {
  apps: [
    {
      name: "composite-mcp-server",
      script: "mcp-server/dist/index.js",
      env_file: ".env",
      watch: false,
      autorestart: true
    },
    {
      name: "composite-slack-bot",
      script: "slack-bot/dist/index.js",
      env_file: ".env",
      watch: false,
      autorestart: true
    }
  ]
};
