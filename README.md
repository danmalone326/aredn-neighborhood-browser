# AREDN Neighborhood Browser

AREDN Neighborhood Browser is a lightweight visualization tool for Amateur Radio Emergency Data Network (AREDN) nodes. Point the app at any reachable mesh node (default `localnode.local.mesh`) and explore its neighborhood through an interactive force-directed graph rendered entirely in vanilla JavaScript.

## Key Features

- **Interactive Graph** – Smooth pan/zoom SVG canvas with a custom physics simulation (no external libraries required).
- **Link Awareness** – WireGuard, DTD, RF, and XLINK paths use distinct colors; hover a link to see the type plus quality/cost metrics.
- **Node States** – White (manually added seeds), yellow (discovered but not expanded), blue ring (query in progress), green (expanded), and red ring (last fetch failed). Click a node to load its latest links.
- **Autocomplete Directory** – Every manually queried node contributes to the Node dropdown so you can easily revisit hosts without retyping.
- **Layout Status Light** – A small indicator up top glows yellow while the physics engine settles and turns green once movement stops.
- **Offline-Friendly** – Pure ES modules + Fetch API; host the `index.html` directory on any static server behind your mesh.

## Getting Started

1. Clone or download the repo onto a machine that can reach your AREDN mesh.
2. Serve the folder with any static web server (e.g., `python3 -m http.server 8080`).
3. Open the site in a modern browser and type a hostname/IP in the **Node** field (or pick from the suggestions). Click **Add** (or press Enter) to load it.
4. Click nodes to expand their neighbors. Use the mouse wheel to zoom and drag empty canvas space to pan. Hit **Reset** to clear the current graph while keeping the autocomplete list intact.

## Project Structure

- `index.html` – Page shell and layout.
- `assets/css/styles.css` – Dark theme, layout, and visual tokens.
- `assets/js/api.js` – AREDN `sysinfo.json` client with timeout protection.
- `assets/js/state.js` – Deduplicated in-memory store for nodes and links.
- `assets/js/graph.js` – Force simulation + SVG rendering + pan/zoom + tooltips.
- `assets/js/main.js` – App orchestration: inputs, autocomplete, fetch workflow, and state-to-graph syncing.

## Notes

- The code was intentionally written without external dependencies so it can run on an offline mesh.
- Hostnames returned with PTR diagnostic text are sanitized automatically (text before the first newline).
- This project was primarily developed by prompting AI assistants.

Contributions and suggestions are welcome! Open an issue or PR on [GitHub](https://github.com/danmalone326/aredn-neighborhood-browser).***
