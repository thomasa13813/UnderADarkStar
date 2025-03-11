#!/bin/bash
# Comprehensive idempotent setup script for Hetzner server with Docker, Docker Compose, and Cloudflare R2 configuration
# Exit on error
set -e

echo 'export EDITOR=vim' >> ~/.bashrc
source ~/.bashrc

echo "🔄 Updating system..."
apt update && apt upgrade -y

# Docker installation - check if already installed
if command -v docker &> /dev/null; then
    echo "✅ Docker is already installed"
else
    echo "🐳 Installing Docker..."
    # Install Docker using official script
    curl -fsSL https://get.docker.com -o get-docker.sh
    sh get-docker.sh
    rm get-docker.sh
    # Make sure Docker is enabled to start at boot
    systemctl enable docker
    echo "✅ Docker installed successfully"
fi

# Check if Docker is running
if systemctl is-active --quiet docker; then
    echo "✅ Docker service is already running"
else
    echo "🚀 Starting Docker service..."
    systemctl start docker
    echo "✅ Docker service started"
fi

# Docker Compose v1 installation - check if already installed
if command -v docker-compose &> /dev/null; then
    echo "✅ Docker Compose v1 is already installed"
else
    echo "🔧 Installing Docker Compose v1..."
    # Get latest docker compose version
    COMPOSE_VERSION=$(curl -s https://api.github.com/repos/docker/compose/releases/latest | grep 'tag_name' | cut -d\" -f4)
    # Install Docker Compose v1
    curl -L "https://github.com/docker/compose/releases/download/${COMPOSE_VERSION}/docker-compose-$(uname -s)-$(uname -m)" -o /usr/local/bin/docker-compose
    chmod +x /usr/local/bin/docker-compose
    echo "✅ Docker Compose v1 installed successfully"
fi

# Docker Compose v2 installation - check if already installed
if command -v docker compose &> /dev/null; then
    echo "✅ Docker Compose plugin (v2) is already installed"
else
    echo "🔧 Installing Docker Compose plugin (v2)..."
    # Install Docker Compose v2
    apt install -y docker-compose-plugin
    echo "✅ Docker Compose plugin (v2) installed successfully"
fi

# Verify Docker Compose installations
echo "Verifying Docker Compose installations..."
echo "Docker Compose v1:"
docker-compose --version
echo "Docker Compose v2:"
docker compose version

# Docker Hub login - only prompt if not already logged in
if [ ! -f ~/.docker/config.json ] || ! grep -q "auth" ~/.docker/config.json; then
    echo "🔐 Setting up Docker Hub login..."
    docker login
    echo "✅ Docker Hub login configured"
else
    echo "✅ Docker Hub login already configured"
fi

# AWS CLI installation - check if already installed
if command -v aws &> /dev/null; then
    echo "✅ AWS CLI is already installed"
else
    echo "☁️ Installing AWS CLI for Cloudflare R2..."
    # Install AWS CLI
    apt install -y unzip curl
    curl "https://awscli.amazonaws.com/awscli-exe-linux-x86_64.zip" -o "awscliv2.zip"
    unzip awscliv2.zip
    ./aws/install
    rm -rf aws awscliv2.zip
    echo "✅ AWS CLI installed successfully"
fi

# R2 configuration - check if already configured
if [ -f ~/.aws/credentials ] && grep -q "\[r2\]" ~/.aws/credentials; then
    echo "✅ R2 configuration already exists"
    echo "Do you want to update the R2 configuration? (y/n)"
    read update_r2
    if [ "$update_r2" = "y" ]; then
        configure_r2=true
    else
        configure_r2=false
    fi
else
    configure_r2=true
fi

if [ "$configure_r2" = true ]; then
    # Configure AWS CLI for R2
    echo "🔧 Configuring AWS CLI for Cloudflare R2..."
    echo "Enter your Cloudflare R2 Access Key ID:"
    read R2_ACCESS_KEY
    echo "Enter your Cloudflare R2 Secret Access Key:"
    read -s R2_SECRET_KEY
    echo "Enter your Cloudflare Account ID:"
    read CLOUDFLARE_ACCOUNT_ID

    # Create R2 profile configuration
    mkdir -p ~/.aws
    
    # Update or create credentials file
    if [ -f ~/.aws/credentials ]; then
        # Remove existing r2 section if it exists
        sed -i '/\[r2\]/,/^$/d' ~/.aws/credentials
    fi
    
    # Append r2 credentials
    cat >> ~/.aws/credentials << EOL
[r2]
aws_access_key_id = $R2_ACCESS_KEY
aws_secret_access_key = $R2_SECRET_KEY
EOL

    # Update or create config file
    if [ -f ~/.aws/config ]; then
        # Remove existing r2 profile if it exists
        sed -i '/\[profile r2\]/,/^$/d' ~/.aws/config
    fi
    
    # Append r2 config
    cat >> ~/.aws/config << EOL
[profile r2]
region = auto
endpoint_url = https://$CLOUDFLARE_ACCOUNT_ID.r2.cloudflarestorage.com
EOL
    echo "✅ R2 configuration complete"
fi

# Setting up Node Exporter for system metrics
echo "📊 Setting up Node Exporter..."

# Create a monitoring network if it doesn't exist
if ! docker network inspect monitoring &>/dev/null; then
    echo "Creating monitoring network..."
    docker network create monitoring
else
    echo "✅ Monitoring network already exists"
fi

# Check if Node Exporter is already running correctly
if docker ps | grep -q "node_exporter"; then
    echo "✅ Node Exporter is already running"
else
    # Remove existing container if it exists but not running
    if docker ps -a | grep -q node_exporter; then
        echo "Removing existing stopped Node Exporter container..."
        docker rm -f node_exporter
    fi

    # Run Node Exporter container
    echo "Starting Node Exporter..."
    docker run -d \
        --name node_exporter \
        --restart unless-stopped \
        --network monitoring \
        -p 9100:9100 \
        -v "/proc:/host/proc:ro" \
        -v "/sys:/host/sys:ro" \
        -v "/:/rootfs:ro" \
        prom/node-exporter:latest \
        --path.procfs=/host/proc \
        --path.sysfs=/host/sys \
        --path.rootfs=/rootfs \
        --collector.filesystem.mount-points-exclude="^/(sys|proc|dev|host|etc)($$|/)"
    echo "✅ Node Exporter is now running and exposing metrics on port 9100"
fi

# Setting up Loki Docker driver for log collection
echo "📜 Setting up Loki Docker driver..."

# Check if plugin is already installed and up to date
if docker plugin ls | grep -q "loki.*latest.*true"; then
    echo "✅ Loki Docker driver is already installed and enabled"
else
    # Remove plugin if it exists but not up to date or not enabled
    if docker plugin ls | grep -q "loki"; then
        echo "Updating Loki Docker driver..."
        docker plugin disable -f loki
        docker plugin rm -f loki
    fi

    # Install Loki Docker driver
    echo "Installing Loki Docker driver..."
    docker plugin install grafana/loki-docker-driver:latest --alias loki --grant-all-permissions
    echo "✅ Loki Docker driver installed successfully!"
fi

echo "Note: Configure your containers with the Loki logging driver by adding this to your docker-compose.yml:"
echo "
  logging:
    driver: loki
    options:
      loki-url: \"http://your-loki-server:3100/loki/api/v1/push\"
      loki-batch-size: \"400\"
      loki-external-labels: \"job=your_app,environment=production\"
"

echo "🎉 Setup complete!"
echo "Test your R2 connection: aws s3 ls --profile r2"
echo "Metrics available at: http://$(hostname -I | awk '{print $1}'):9100/metrics"