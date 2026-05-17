# Router Manager

Router Manager is a lightweight web control panel for MikroTik RouterOS devices.
It combines a Go backend with an embedded React frontend to show live router
status, identify the current client, manage DHCP lease state, and switch routing
tables for the client's source-IP rule.

## Features

- Check RouterOS connection status and device uptime.
- See the IP address detected for your current client.
- View DHCP lease details for the current client IP.
- One-click conversion of a dynamic DHCP lease into a static lease.
- Port Mapping add/edit/enable/disable for the current client IP.
- Switch the routing table for the current client's source-IP rule.
- Bridge host lookup to show the physical/interface port for the client MAC.
- Single-binary deployment with the built web UI embedded.
- Docker image build with frontend and backend stages.

## Installation

Create a `config.yaml` file:

```yaml
server:
  host: "0.0.0.0"
  port: 8080

router:
  host: "192.168.88.1"
  port: 8728
  username: "admin"
  password: "your-routeros-password"
  useTLS: false
  debug: false
```

### RouterOS requirements

- Developed and tested with RouterOS 7.x.
- RouterOS API must be enabled on the target router.
- Use port `8728` for plain RouterOS API or `8729` with `useTLS: true` when
  using the TLS API.
- The routing-rule UI expects an existing lookup rule where `src-address`
  matches the current client IP as `/32`.

### Portable binary

Download the latest binary from
[router-manager/releases](https://github.com/jstarstech/router-manager/releases),
place your `config.yaml` next to it, and run:

```bash
./router-manager
```

### Docker image

Pull the prebuilt image from GitHub Container Registry:

```bash
docker pull ghcr.io/jstarstech/router-manager:latest
```

Run it with your local configuration:

```bash
docker run --name router-manager --restart unless-stopped -p 8080:8080 -v "$PWD/config.yaml:/app/config.yaml:ro" ghcr.io/jstarstech/router-manager:latest
```

### Reverse proxy

> **Important:** if Router Manager is running behind a reverse proxy, forward
> the original client IP with the `X-Forwarded-For` header. The app uses that IP
> to find the matching DHCP lease and routing rule.

## Usage

Start the server and open the web UI:

```text
http://localhost:8080
```

## Development

Clone the repository:

```bash
git clone git@github.com:jstarstech/router-manager.git
cd router-manager
```

Install frontend dependencies and build the embedded frontend:

```bash
make frontend
```

Build the Go binary:

```bash
make build
```

Run both steps and start the app:

```bash
make run
```

For local development with the Go server and Vite dev server:

```bash
make dev
```

### Docker

Build the image:

```bash
docker build -t router-manager .
```

Run it:

```bash
docker run --rm -p 8080:8080 -v "$PWD/config.yaml:/app/config.yaml:ro" router-manager
```

Then open:

```text
http://localhost:8080
```

### Release Builds

The Makefile includes cross-compilation targets:

```bash
make build-linux
make build-darwin
make build-windows
```

To build the frontend and all release binaries:

```bash
make release
```
