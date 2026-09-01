# Nebula Browser

Nebula is a self-hosted web browser interface powered by the Scramjet rewriting proxy and a local Wisp transport server. Sites load inside Nebula instead of being sent to a normal browser tab.

## What is included

- Built-in Scramjet proxy frame
- Wisp WebSocket transport hosted by the same Node server
- Tabs, address search, back, forward, reload, fullscreen, and shortcuts
- Desktop and mobile layouts
- Lightweight black-and-red effects that automatically pause while browsing
- Optional access key for private deployments
- Private-network, loopback, direct-IP, UDP, and non-web-port blocking
- Docker and Render deployment files

## Run locally

Requirements: Node.js 20 or newer and Corepack.

```bash
corepack enable
pnpm install --frozen-lockfile
pnpm start
```

Open `http://localhost:8080`.

## Run with Docker

```bash
docker build -t nebula-browser .
docker run --rm -p 8080:8080 -e ACCESS_KEY="choose-a-long-random-password" nebula-browser
```

Then open `http://localhost:8080/?key=choose-a-long-random-password` once. Nebula saves access in an HTTP-only cookie.

## Deploy

This project must run as a Node/Docker web service with WebSocket support. It cannot be deployed as a static Cloudflare Pages upload.

For Render, place the project in a GitHub repository, create a new Blueprint, and select the repository. `render.yaml` configures the Docker service and generates an access key. Copy that environment value from the service dashboard, then visit `https://YOUR-SERVICE.onrender.com/?key=VALUE` once.

## Performance

The visual effects use two compositor-friendly CSS lines instead of a canvas particle loop. Effects stop while a page is open and default to off on screens 700 px wide or smaller. They can be changed in Settings.

## Security notes

- Set `ACCESS_KEY` before exposing the service publicly.
- Private IPs, loopback hosts, direct IP destinations, UDP, and ports other than 80/443 are blocked by default.
- The access key is optional locally but should not be omitted on a public server.
- A web proxy is not a device-wide VPN. Only pages loaded inside Nebula use its proxy transport.
- Some websites may still reject proxy traffic, CAPTCHAs, or logins.

Use the service only on networks and websites you are authorized to access.

## Credits and license

The proxy engine is [Scramjet](https://github.com/MercuryWorkshop/scramjet) and the transport is [Wisp](https://github.com/MercuryWorkshop/wisp-js), maintained by Mercury Workshop. Their bundled notices remain available at `/credits.html`.

This combined source distribution is provided under the GNU Affero General Public License v3. See `LICENSE`.
