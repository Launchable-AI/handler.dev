FROM ubuntu:24.04

# Install SSH server and minimal tools
RUN apt-get update && apt-get install -y \
    openssh-server \
    sudo \
    curl \
    wget \
    git \
    && rm -rf /var/lib/apt/lists/* \
    && mkdir -p /var/run/sshd

# Create non-root user with sudo access
RUN useradd -m -s /bin/bash dev \
    && echo 'dev ALL=(ALL) NOPASSWD:ALL' >> /etc/sudoers

# Configure SSH for key-based auth only
RUN sed -i 's/#PubkeyAuthentication.*/PubkeyAuthentication yes/' /etc/ssh/sshd_config \
    && sed -i 's/#PasswordAuthentication.*/PasswordAuthentication no/' /etc/ssh/sshd_config

# Setup SSH key ({{PUBLIC_KEY}} is replaced at build time)
RUN mkdir -p /home/dev/.ssh \
    && chmod 700 /home/dev/.ssh \
    && echo '{{PUBLIC_KEY}}' > /home/dev/.ssh/authorized_keys \
    && chmod 600 /home/dev/.ssh/authorized_keys \
    && chown -R dev:dev /home/dev/.ssh

# Set working directory
RUN mkdir -p /home/dev/workspace && chown dev:dev /home/dev/workspace
WORKDIR /home/dev/workspace

EXPOSE 22
CMD ["/usr/sbin/sshd", "-D"]
