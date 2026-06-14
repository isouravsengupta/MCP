#!/bin/bash
# Run once on a fresh EC2 instance to set up the server
set -e

# Install Node.js 20
curl -fsSL https://rpm.nodesource.com/setup_20.x | sudo bash -
sudo yum install -y nodejs git

# Install PM2
sudo npm install -g pm2

# Clone repo
git clone https://github.com/isouravsengupta/MCP.git /app/composite-mcp-repo
ln -s "/app/composite-mcp-repo/composite mcp" /app/composite-mcp
cd /app/composite-mcp

# Install dependencies
cd mcp-server && npm install && npm run build && cd ..
cd slack-bot && npm install && npm run build && cd ..

# Copy env (you must upload .env to /app/composite-mcp/.env manually)
echo "Upload your .env file to /app/composite-mcp/.env then run:"
echo "pm2 start ecosystem.config.cjs"
echo "pm2 save"
echo "pm2 startup"
