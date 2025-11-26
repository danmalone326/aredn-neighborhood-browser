/**
 * main.js wires together API calls, in-memory state, and the SVG renderer.
 * Keeping orchestration here makes it easy to replace any layer independently.
 */
import { MeshApi } from './api.js';
import { GraphState } from './state.js';
import { GraphRenderer } from './graph.js';

const DEFAULT_SEED = 'localnode.local.mesh';
const api = new MeshApi();
const state = new GraphState();
const inflightNodes = new Set();
let hostDirectory = [];
let seedInputFocused = false;

const dom = {
  status: document.getElementById('graph-status'),
  canvas: document.getElementById('graph-canvas'),
  seedForm: document.getElementById('seed-form'),
  seedInput: document.getElementById('seed-input'),
  seedSubmit: document.querySelector('#seed-form button[type="submit"]'),
  seedSuggestions: document.getElementById('seed-suggestions'),
  infoBody: document.getElementById('info-panel-body'),
  resetBtn: document.getElementById('clear-graph'),
};

// Renderer owns the physics simulation and click handling for nodes.
const renderer = new GraphRenderer(dom.canvas, {
  onNodeClick: (node) => handleNodeSelection(node, { expand: true }),
});

bootstrap();

/** Entry point that wires DOM events and loads the default node. */
function bootstrap() {
  dom.seedForm.addEventListener('submit', (event) => {
    event.preventDefault();
    loadSeed(dom.seedInput.value.trim() || DEFAULT_SEED, { includeHosts: true });
  });

  dom.resetBtn.addEventListener('click', () => {
    dom.seedInput.value = DEFAULT_SEED;
    loadSeed(DEFAULT_SEED, { includeHosts: true });
  });

  dom.seedInput.addEventListener('input', handleSeedInputChange);
  dom.seedInput.addEventListener('focus', () => {
    seedInputFocused = true;
    handleSeedInputChange();
  });
  dom.seedInput.addEventListener('blur', () => {
    seedInputFocused = false;
    hideSeedSuggestions();
  });
  dom.seedSuggestions.addEventListener('mousedown', (event) => event.preventDefault());
  dom.seedSuggestions.addEventListener('click', handleSuggestionClick);
  document.addEventListener('click', (event) => {
    const target = event.target;
    if (!(target instanceof HTMLElement)) return;
    if (
      target === dom.seedInput ||
      dom.seedSuggestions.contains(target) ||
      target.closest('.seed-input-wrapper')
    ) {
      return;
    }
    hideSeedSuggestions();
  });

  loadSeed(DEFAULT_SEED, { includeHosts: true });
}

/**
 * Load a seed host, resetting the graph before populating with new data.
 * @param {string} seedHost
 */
async function loadSeed(seedHost, { includeHosts = false } = {}) {
  const target = seedHost || DEFAULT_SEED;
  setStatus(`Loading ${target}...`, 'info');
  dom.seedInput.value = target;
  toggleControls(true);
  if (includeHosts) {
    hostDirectory = [];
    hideSeedSuggestions();
  }
  state.reset();
  renderer.sync(state.getGraphData());
  renderInfoMessage('Select a node to see details.');

  try {
    const root = await ingestNode(target, 0, { includeHosts });
    renderer.setActiveNode(root?.id);
    handleNodeSelection(root, { expand: false });
  } catch (error) {
    console.error(error);
  } finally {
    toggleControls(false);
  }
}

/**
 * Normalize hostnames by stripping scheme/trailing slash for ID consistency.
 * @param {string} value
 * @returns {string}
 */
function normalizeEndpoint(value) {
  return value
    .trim()
    .replace(/^https?:\/\//i, '')
    .replace(/\/$/, '')
    .toLowerCase();
}

/** Toggle input/button disable state during network work. */
function toggleControls(disabled) {
  dom.seedInput.disabled = disabled;
  dom.seedSubmit.disabled = disabled;
  dom.resetBtn.disabled = disabled;
}

/** Render a friendly message in the info panel. */
function renderInfoMessage(message) {
  dom.infoBody.innerHTML = `<dd>${message}</dd>`;
}

/** Handle search box typing to show host matches. */
function handleSeedInputChange() {
  if (!seedInputFocused) {
    hideSeedSuggestions();
    return;
  }
  const query = dom.seedInput.value.trim().toLowerCase();
  if (!query || !hostDirectory.length) {
    hideSeedSuggestions();
    return;
  }

  const matches = hostDirectory
    .filter((entry) => {
      const name = entry.name?.toLowerCase() ?? '';
      const ip = entry.ip ?? '';
      return name.includes(query) || ip.includes(query);
    })
    .slice(0, 8);

  if (!matches.length) {
    hideSeedSuggestions();
    return;
  }

  renderSeedSuggestions(matches);
}

/** Clear autocomplete dropdown. */
function hideSeedSuggestions() {
  dom.seedSuggestions.classList.remove('visible');
  dom.seedSuggestions.innerHTML = '';
}

/** Render suggestion list items safely. */
function renderSeedSuggestions(matches) {
  dom.seedSuggestions.innerHTML = '';
  matches.forEach((entry) => {
    const li = document.createElement('li');
    li.dataset.hostName = entry.name || '';
    li.dataset.hostIp = entry.ip || '';

    const nameSpan = document.createElement('span');
    nameSpan.classList.add('host-name');
    nameSpan.textContent = entry.name || '(unnamed)';

    const ipSpan = document.createElement('span');
    ipSpan.classList.add('host-ip');
    ipSpan.textContent = entry.ip || 'unknown';

    li.appendChild(nameSpan);
    li.appendChild(ipSpan);
    dom.seedSuggestions.appendChild(li);
  });
  dom.seedSuggestions.classList.add('visible');
}

/** Respond to suggestion selection. */
function handleSuggestionClick(event) {
  const item = event.target.closest('li[data-host-name]');
  if (!item) return;
  event.preventDefault();
  applySeedSuggestion({
    name: item.dataset.hostName || '',
    ip: item.dataset.hostIp || '',
  });
}

/** Apply a chosen host to the seed input and reload graph. */
function applySeedSuggestion(host) {
  const hostname = host.name?.trim();
  let nextSeed = null;
  if (hostname) {
    const trimmed = hostname.endsWith('.local.mesh') ? hostname : `${hostname}.local.mesh`;
    nextSeed = trimmed;
  } else if (host.ip) {
    nextSeed = host.ip;
  }
  if (!nextSeed) return;

  dom.seedInput.value = nextSeed;
  hideSeedSuggestions();
  loadSeed(nextSeed, { includeHosts: true });
}

/** Persist host list from the most recent seed node response. */
function updateHostDirectory(entries = []) {
  hostDirectory = entries
    .filter((entry) => {
      if (!entry || (!entry.name && !entry.ip)) return false;
      const name = entry.name?.trim().toLowerCase() ?? '';
      return !name.endsWith('.local.mesh');
    })
    .map((entry) => ({
      name: entry.name?.trim() ?? '',
      ip: entry.ip?.trim() ?? '',
    }))
    .sort((a, b) => {
      const aLabel = a.name?.toLowerCase() || a.ip;
      const bLabel = b.name?.toLowerCase() || b.ip;
      return aLabel.localeCompare(bLabel);
    });
}

/**
 * Converts the hostname reported by the API into a reachable endpoint.
 * Falls back to null when hostname is missing/invalid so callers can default to IP.
 * @param {string} hostname
 * @returns {string|null}
 */
function resolveHostnameEndpoint(hostname) {
  if (!hostname) return null;
  const trimmed = hostname.trim().toLowerCase();
  if (!trimmed) return null;
  return trimmed.endsWith('.local.mesh') ? trimmed : `${trimmed}.local.mesh`;
}

/**
 * Maps the linkType attribute to an SVG class that controls color/stroke.
 * @param {string} linkType
 * @returns {string}
 */
function resolveLinkStyleClass(linkType) {
  if (!linkType) return 'link-default';
  const normalized = linkType.trim().toUpperCase();
  switch (normalized) {
    case 'WIREGUARD':
      return 'link-wireguard';
    case 'DTD':
      return 'link-dtd';
    case 'RF':
      return 'link-rf';
    case 'XLINK':
      return 'link-xlink';
    default:
      return 'link-default';
  }
}

/**
 * Ensures a node is fetched and ingested into state if needed.
 * @param {string} endpoint
 * @param {number} level
 */
async function ingestNode(endpoint, level, options = {}) {
  const { nodeId, includeHosts = false } = options;
  const normalizedId = normalizeEndpoint(endpoint);
  const lookupId = nodeId ?? normalizedId;
  const existing = state.getNode(lookupId);
  if (existing?.expanded) {
    setStatus(`${existing.label} already expanded.`, 'info');
    return existing;
  }

  if (inflightNodes.has(normalizedId)) {
    return existing;
  }

  inflightNodes.add(normalizedId);
  try {
    setStatus(`Querying ${endpoint}...`, 'info');
    const payload = await api.fetchLinkInfo(endpoint, { includeHosts });
    if (includeHosts) {
      updateHostDirectory(payload.hosts ?? []);
      handleSeedInputChange();
    }
    const record = registerPayload(endpoint, payload, level, { nodeId });
    setStatus(`Loaded ${Object.keys(payload.link_info ?? {}).length} links from ${record.label}`, 'success');
    return record;
  } catch (error) {
    setStatus(`Failed to reach ${endpoint}: ${error.message}`, 'error');
    throw error;
  } finally {
    inflightNodes.delete(normalizedId);
  }
}

/**
 * Converts a sysinfo payload into nodes/links for the graph.
 * @param {string} endpoint
 * @param {Object} payload
 * @param {number} level
 */
function registerPayload(endpoint, payload, level, options = {}) {
  const requestedId = options.nodeId ?? normalizeEndpoint(endpoint);
  const derivedHostnameEndpoint = resolveHostnameEndpoint(payload.node);
  const canonicalEndpoint = derivedHostnameEndpoint ?? endpoint;
  const canonicalId = normalizeEndpoint(canonicalEndpoint) ?? requestedId;
  const label = payload.node || endpoint;
  const endpointAlias = normalizeEndpoint(endpoint);
  const aliasSet = new Set(
    [requestedId, endpointAlias].filter((candidate) => candidate && candidate !== canonicalId),
  );
  const nodeRecord = state.upsertNode({
    id: canonicalId,
    label,
    endpoint: canonicalEndpoint,
    level,
    type: level <= 1 ? 'local' : 'neighborhood',
    metadata: payload,
    aliases: Array.from(aliasSet),
  });

  // link_info exposes immediate neighbors keyed by IP. We treat the first hop
  // from the seed as "local" (green) and anything beyond as "neighborhood"
  // (yellow). This assumption is documented so it can be revisited if the API
  // later distinguishes the types explicitly.
  const entries = Object.entries(payload.link_info ?? {});
  entries.forEach(([ip, linkInfo]) => {
    const neighborId = normalizeEndpoint(ip);
    const neighborLevel = level === 0 ? 1 : level + 1;
    const neighborType = neighborLevel <= 1 ? 'local' : 'neighborhood';
    const neighborEndpoint = resolveHostnameEndpoint(linkInfo.hostname) ?? ip;
    const neighborEndpointId = normalizeEndpoint(neighborEndpoint);
    const canonicalNeighborId = neighborEndpointId ?? neighborId;
    const existingNeighborId =
      state.resolveNodeId(neighborId) ?? state.resolveNodeId(canonicalNeighborId);
    const resolvedNeighborId = existingNeighborId ?? canonicalNeighborId ?? neighborId;
    const aliasSet = new Set(
      [neighborId, neighborEndpointId, canonicalNeighborId].filter(
        (value) => value && value !== resolvedNeighborId,
      ),
    );

    const neighborRecord = state.upsertNode({
      id: resolvedNeighborId,
      label: linkInfo.hostname || ip,
      endpoint: neighborEndpoint,
      level: neighborLevel,
      type: neighborType,
      aliases: Array.from(aliasSet),
    });

    neighborRecord.metadata = neighborRecord.metadata ?? {};
    neighborRecord.metadata.primaryIp = neighborRecord.metadata.primaryIp ?? ip;
    neighborRecord.metadata.hostname = linkInfo.hostname ?? neighborRecord.metadata.hostname;
    // Store last seen link metrics so the info panel can surface them even
    // before we fully expand the neighbor node.
    neighborRecord.lastLinkMetrics = linkInfo;
    neighborRecord.lastKnownHostname = linkInfo.hostname;

    const styleClass = resolveLinkStyleClass(linkInfo.linkType);

    state.upsertLink({
      source: nodeRecord.id,
      target: neighborRecord.id,
      kind: neighborType === 'local' ? 'local' : 'neighborhood',
      styleClass,
      linkType: linkInfo.linkType,
      metrics: linkInfo,
    });
  });

  state.markExpanded(nodeRecord.id);
  renderer.sync(state.getGraphData());
  return nodeRecord;
}

/** Handles node selection, optionally triggering expansion. */
async function handleNodeSelection(node, { expand }) {
  if (!node) return;
  renderer.setActiveNode(node.id);
  renderNodeDetails(node);
  if (expand && !node.expanded) {
    try {
      await ingestNode(node.endpoint, node.level ?? 1, { nodeId: node.id });
    } catch (error) {
      console.error(error);
    }
  }
}

/**
 * Populate info panel with human-readable metadata for the selected node.
 * Highlights whichever information we currently have.
 */
function renderNodeDetails(node) {
  if (!node) {
    renderInfoMessage('Select a node to see details.');
    return;
  }

  const metadata = node.metadata || {};
  const nodeDetails = metadata.node_details || {};
  const linkCount = Array.from(state.links.values()).filter(
    (link) => link.source === node.id || link.target === node.id,
  ).length;

  const entries = [
    ['Label', node.label],
    ['Endpoint', node.endpoint],
    ['Level', node.level === 0 ? 'Seed' : node.level === 1 ? 'Local' : `Neighborhood L${node.level}`],
    ['Links', `${linkCount}`],
  ];

  if (nodeDetails.model) {
    entries.push(['Model', nodeDetails.model]);
  }
  if (metadata.node) {
    entries.push(['Node ID', metadata.node]);
  }
  if (nodeDetails.description) {
    entries.push(['Description', nodeDetails.description]);
  }
  if (metadata.grid_square) {
    entries.push(['Grid', metadata.grid_square]);
  }
  if (metadata.hostname) {
    const hostEndpoint = resolveHostnameEndpoint(metadata.hostname) ?? metadata.hostname;
    entries.push(['Hostname', hostEndpoint]);
  }
  if (metadata.primaryIp) {
    entries.push(['Primary IP', metadata.primaryIp]);
  }
  if (metadata.lat && metadata.lon) {
    entries.push(['Coordinates', `${metadata.lat}, ${metadata.lon}`]);
  }
  if (metadata.sysinfo?.uptime) {
    entries.push(['Uptime', metadata.sysinfo.uptime]);
  }
  if (node.lastLinkMetrics) {
    entries.push(['Link Cost', node.lastLinkMetrics.linkCost]);
    entries.push(['Link Type', node.lastLinkMetrics.linkType]);
  }

  dom.infoBody.innerHTML = entries
    .map(([label, value]) => `<dt>${label}</dt><dd>${value ?? 'N/A'}</dd>`)
    .join('');
}

/** Simple status badge helper. */
function setStatus(message, tone = 'info') {
  dom.status.textContent = message;
  dom.status.className = `graph-status status-${tone}`;
}
