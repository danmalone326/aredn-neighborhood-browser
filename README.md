# AREDN Neighborhood Browser

AREDN Neighborhood Browser is a single-page exploration tool for Amateur Radio Emergency Data Network (AREDN) nodes. Point the app at any mesh node (default `localnode.local.mesh`), and it will visualize the node's local and neighborhood links as an interactive force-directed graph. Click a node to fetch its neighbors, and watch the graph expand with color-coded nodes and link types.

## Features

- **Force-Directed Graph** – Pure JavaScript physics simulation renders nodes/links with smooth pan/zoom interactions.
- **Link Type Coloring** – WireGuard, DTD, RF, and XLINK links use distinct stroke styles; hovering a link shows live metrics.
- **Node Status** – White for the seed node, yellow for discovered nodes, blue ring for in-progress queries, green for expanded nodes, and red for failed attempts.
- **Hostname Autocomplete** – The seed input offers suggestions from the start node’s `hosts` list (via `hosts=1`) so you can jump directly to any known node or service.
- **Offline-Friendly** – Uses browser `fetch` with no external frameworks; vendored dependencies can be hosted alongside the app.

## Getting Started

1. Serve the repository from any static web server (e.g., `python3 -m http.server`).
2. Open the site in a modern browser that can reach your AREDN mesh.
3. Enter a hostname or IP in the **Start Node** field (or pick from the suggestions) and click **Reset** to load the graph.
4. Click nodes to expand them. Use the mouse wheel to zoom and drag the canvas background to pan.

## Development Notes

- The app lives entirely in `index.html`, `assets/css/styles.css`, and `assets/js/*`.
- `main.js` orchestrates API calls (`api.js`), in-memory state (`state.js`), and the SVG renderer (`graph.js`).
- All hostnames are sanitized before use to guard against PTR record noise.
- The project avoids external CDNs; include any libraries (like a minified D3) in `assets/lib/` if needed in the future.

Contributions and ideas are welcome! Open an issue or PR on [GitHub](https://github.com/danmalone326/aredn-neighborhood-browser).***
