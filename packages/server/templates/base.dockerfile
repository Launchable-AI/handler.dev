FROM ubuntu:24.04

# Install common development tools
RUN apt-get update && apt-get install -y \
    sudo \
    curl \
    wget \
    git \
    neovim \
    build-essential \
    python3 \
    python3-pip \
    python3-venv \
    nodejs \
    npm \
    && rm -rf /var/lib/apt/lists/*

# Create non-root user with sudo access
RUN useradd -m -s /bin/bash dev \
    && echo 'dev ALL=(ALL) NOPASSWD:ALL' >> /etc/sudoers

# Add ~/.local/bin to PATH for pip-installed tools
RUN echo 'export PATH="$HOME/.local/bin:$PATH"' >> /home/dev/.bashrc

# Set working directory
RUN mkdir -p /home/dev/workspace && chown dev:dev /home/dev/workspace
WORKDIR /home/dev/workspace

USER dev
CMD ["bash"]
