/**
 * main.js wires together API calls, in-memory state, and the SVG renderer.
 * Keeping orchestration here makes it easy to replace any layer independently.
 */
import { MeshApi } from './api.js';
import { GraphState } from './state.js';
import { GraphRenderer } from './graph.js';
import { createSimIndicator } from './dom.js';

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
  addButton: document.getElementById('add-node-btn'),
  resetBtn: document.getElementById('reset-graph'),
  seedSuggestions: document.getElementById('seed-suggestions'),
  infoBody: document.getElementById('info-panel-body'),
  graphStats: document.getElementById('graph-stats'),
};
const { container: simIndicatorEl, light: simLightEl } = createSimIndicator();
const graphPanel = document.querySelector('.graph-panel');
graphPanel?.appendChild(simIndicatorEl);
const domSimIndicator = simIndicatorEl;
const domSimLight = simLightEl;

// Renderer owns the physics simulation and click handling for nodes.
const renderer = new GraphRenderer(dom.canvas, {
  onNodeClick: (node) => handleNodeSelection(node, { expand: true }),
  onStabilityChange: (stable) => updateSimStatus(stable),
});
let activeNodeId = null;

function setActiveNode(nodeId) {
  activeNodeId = nodeId ?? null;
  renderer.setActiveNode(nodeId ?? null);
}

function syncGraph() {
  const snapshot = state.getGraphData();
  renderer.sync(snapshot);
  if (activeNodeId) {
    setActiveNode(activeNodeId);
  }
  renderGraphStats(snapshot);
}

bootstrap();

/** Entry point that wires DOM events and loads the default node. */
function bootstrap() {
  updateSimStatus(false);
  dom.seedForm.addEventListener('submit', (event) => {
    event.preventDefault();
    handleAddNode();
  });
  dom.addButton.addEventListener('click', (event) => {
    event.preventDefault();
    handleAddNode();
  });
  dom.resetBtn.addEventListener('click', resetGraph);

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

  renderGraphStats();
  handleAddNode(DEFAULT_SEED);
}

/** Add a node from the input field (or provided value) into the graph. */
function handleAddNode(seedOverride) {
  const candidate =
    typeof seedOverride === 'string' ? seedOverride : dom.seedInput.value.trim();
  const target = candidate || DEFAULT_SEED;
  dom.seedInput.value = target;
  hideSeedSuggestions();
  addNode(target, { manualSeed: true, includeHosts: true });
}

/** Clear all rendered nodes/links but keep cached host suggestions. */
function resetGraph() {
  inflightNodes.clear();
  state.reset();
  syncGraph();
  setActiveNode(null);
  renderInfoMessage('Select a node to see details.');
  hideSeedSuggestions();
  setStatus('Graph cleared. Add a node to begin exploring.', 'info');
}

/**
 * Adds a root node into the current graph without clearing existing nodes.
 * @param {string} seedHost
 * @param {Object} options
 */
async function addNode(seedHost, { manualSeed = false, includeHosts = false } = {}) {
  const target = seedHost || DEFAULT_SEED;
  setStatus(`Loading ${target}...`, 'info');
  toggleControls(true);
  renderInfoMessage('Select a node to see details.');

  try {
    const initialPosition = manualSeed
      ? randomizePosition(renderer.getViewportCenter(), 100)
      : undefined;
    const root = await ingestNode(target, 0, {
      includeHosts,
      manualSeed,
      initialPosition,
    });
    setActiveNode(root?.id ?? null);
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
  dom.addButton.disabled = disabled;
  dom.resetBtn.disabled = disabled;
}

/** Render a friendly message in the info panel. */
function renderInfoMessage(message) {
  const dd = document.createElement('dd');
  dd.textContent = message;
  dom.infoBody.replaceChildren(dd);
}

/** Update simulation status indicator based on force layout movement. */
function updateSimStatus(isStable) {
  if (!domSimIndicator) return;
  if (isStable) {
    domSimIndicator.classList.add('stable');
    domSimLight?.setAttribute('title', 'Layout stable');
  } else {
    domSimIndicator.classList.remove('stable');
    domSimLight?.setAttribute('title', 'Layout settling…');
  }
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
  addNode(nextSeed, { manualSeed: true, includeHosts: true });
}

/** Persist host list from the most recent seed node response. */
function updateHostDirectory(entries = []) {
  if (!entries.length) return;
  const existingMap = new Map();
  hostDirectory.forEach((entry) => {
    const key = `${entry.name || ''}|${entry.ip || ''}`;
    existingMap.set(key, entry);
  });

  entries
    .filter((entry) => entry && (entry.name || entry.ip))
    .forEach((entry) => {
      const sanitizedName = sanitizeHostname(entry.name);
      const lowerName = sanitizedName.toLowerCase();
      if (lowerName.endsWith('.local.mesh')) return;
      const payload = {
        name: sanitizedName,
        ip: entry.ip?.trim() ?? '',
      };
      const key = `${payload.name || ''}|${payload.ip || ''}`;
      if (!existingMap.has(key)) {
        existingMap.set(key, payload);
      }
    });

  hostDirectory = Array.from(existingMap.values()).sort((a, b) => {
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

/** Removes extra diagnostic text (e.g., PTR record) that may trail hostnames. */
function sanitizeHostname(value) {
  if (!value) return '';
  const [firstLine] = value.split(/\r?\n/);
  return firstLine.trim();
}

function randomizePosition(base = renderer.getViewportCenter(), spread = 100) {
  const nodes = state.getGraphData().nodes;
  const taken = new Set(
    nodes
      .filter((node) => typeof node.x === 'number' && typeof node.y === 'number')
      .map((node) => `${node.x.toFixed(3)}:${node.y.toFixed(3)}`),
  );
  const centerX = base?.x ?? renderer.getViewportCenter().x;
  const centerY = base?.y ?? renderer.getViewportCenter().y;
  for (let attempt = 0; attempt < 30; attempt += 1) {
    const x = centerX + (Math.random() - 0.5) * spread;
    const y = centerY + (Math.random() - 0.5) * spread;
    const key = `${x.toFixed(3)}:${y.toFixed(3)}`;
    if (!taken.has(key)) {
      return { x, y };
    }
  }
  return {
    x: centerX + (Math.random() - 0.5) * spread,
    y: centerY + (Math.random() - 0.5) * spread,
  };
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
  const {
    nodeId,
    includeHosts = false,
    manualSeed = false,
    initialPosition,
    originNode = null,
  } = options;
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
  const pendingNode = state.getNode(lookupId);
  if (pendingNode) {
    pendingNode.loading = true;
    pendingNode.failed = false;
    syncGraph();
  }
  try {
    setStatus(`Querying ${endpoint}...`, 'info');
    const payload = await api.fetchLinkInfo(endpoint, { includeHosts });
    if (includeHosts) {
      updateHostDirectory(payload.hosts ?? []);
      handleSeedInputChange();
    }
    const record = registerPayload(endpoint, payload, level, {
      nodeId,
      manualSeed,
      initialPosition,
      originNode,
    });
    setStatus(`Loaded ${Object.keys(payload.link_info ?? {}).length} links from ${record.label}`, 'success');
    return record;
  } catch (error) {
    setStatus(`Failed to reach ${endpoint}: ${error.message}`, 'error');
    const targetNode = state.getNode(lookupId);
    if (targetNode) {
      targetNode.loading = false;
      targetNode.failed = true;
      syncGraph();
    }
    throw error;
  } finally {
    inflightNodes.delete(normalizedId);
    const targetNode = state.getNode(lookupId);
    if (targetNode && !targetNode.failed) {
      targetNode.loading = false;
    }
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
  const cleanedNodeName = sanitizeHostname(payload.node);
  const derivedHostnameEndpoint = resolveHostnameEndpoint(cleanedNodeName);
  const canonicalEndpoint = derivedHostnameEndpoint ?? endpoint;
  const canonicalId = normalizeEndpoint(canonicalEndpoint) ?? requestedId;
  const label = cleanedNodeName || endpoint;
  const endpointAlias = normalizeEndpoint(endpoint);
  const existingByRequested =
    state.getNode(requestedId) ?? (endpointAlias ? state.getNode(endpointAlias) : undefined);
  if (existingByRequested && canonicalId && existingByRequested.id !== canonicalId) {
    state.rekeyNode(existingByRequested.id, canonicalId);
  }
  const aliasSet = new Set(
    [requestedId, endpointAlias].filter((candidate) => candidate && candidate !== canonicalId),
  );
  const existingRoot = state.getNode(canonicalId);
  const manualFlag = existingRoot?.manual || options.manualSeed || false;
  const mergedMetadata = payload
    ? { ...(existingRoot?.metadata ?? {}), ...payload }
    : existingRoot?.metadata ?? {};
  const nodePayload = {
    id: canonicalId,
    label,
    endpoint: canonicalEndpoint,
    level,
    type: level <= 1 ? 'local' : 'neighborhood',
    metadata: mergedMetadata,
    aliases: Array.from(aliasSet),
    manual: manualFlag,
  };
  if (!existingRoot && options.manualSeed && options.initialPosition) {
    nodePayload.x = options.initialPosition.x;
    nodePayload.y = options.initialPosition.y;
  }
  const nodeRecord = state.upsertNode(nodePayload);
  nodeRecord.manual = manualFlag;
  nodeRecord.loading = false;
  nodeRecord.failed = false;
  const parentPosition = {
    x: options.originNode?.x ?? nodeRecord.x ?? null,
    y: options.originNode?.y ?? nodeRecord.y ?? null,
  };

  // link_info exposes immediate neighbors keyed by IP. We treat the first hop
  // from the seed as "local" (green) and anything beyond as "neighborhood"
  // (yellow). This assumption is documented so it can be revisited if the API
  // later distinguishes the types explicitly.
  const entries = Object.entries(payload.link_info ?? {});
  const totalNeighbors = entries.length || 1;
  const hostEntries = [];
  entries.forEach(([ip, linkInfo], index) => {
    const neighborId = normalizeEndpoint(ip);
    const neighborLevel = level === 0 ? 1 : level + 1;
    const neighborType = neighborLevel <= 1 ? 'local' : 'neighborhood';
    const cleanedHostname = sanitizeHostname(linkInfo.hostname);
    const neighborEndpoint = resolveHostnameEndpoint(cleanedHostname) ?? ip;
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

    const existingNeighbor = state.getNode(resolvedNeighborId);
    const neighborPayload = {
      id: resolvedNeighborId,
      label: cleanedHostname || ip,
      endpoint: neighborEndpoint,
      level: neighborLevel,
      type: neighborType,
      aliases: Array.from(aliasSet),
    };
    if (!existingNeighbor) {
      if (parentPosition.x != null && parentPosition.y != null) {
        const angle = (2 * Math.PI * index) / totalNeighbors;
        const radius = 100;
        neighborPayload.x = parentPosition.x + radius * Math.cos(angle);
        neighborPayload.y = parentPosition.y + radius * Math.sin(angle);
      } else {
        const jittered = randomizePosition(renderer.getViewportCenter(), 100);
        neighborPayload.x = jittered.x;
        neighborPayload.y = jittered.y;
      }
    }

    const neighborRecord = state.upsertNode(neighborPayload);

    neighborRecord.metadata = neighborRecord.metadata ?? {};
    neighborRecord.metadata.primaryIp = neighborRecord.metadata.primaryIp ?? ip;
    neighborRecord.metadata.hostname =
      cleanedHostname || neighborRecord.metadata.hostname || '';
    // Store last seen link metrics so the info panel can surface them even
    // before we fully expand the neighbor node.
    neighborRecord.lastLinkMetrics = linkInfo;
    neighborRecord.lastKnownHostname = cleanedHostname;

    const styleClass = resolveLinkStyleClass(linkInfo.linkType);

    state.upsertLink({
      source: nodeRecord.id,
      target: neighborRecord.id,
      kind: neighborType === 'local' ? 'local' : 'neighborhood',
      styleClass,
      linkType: linkInfo.linkType,
      metrics: linkInfo,
    });

    if (cleanedHostname || ip) {
      hostEntries.push({ name: cleanedHostname, ip });
    }
  });

  if (hostEntries.length) {
    updateHostDirectory(hostEntries);
  }

  state.markExpanded(nodeRecord.id);
  nodeRecord.loading = false;
  nodeRecord.failed = false;
  syncGraph();
  return nodeRecord;
}

/** Handles node selection, optionally triggering expansion. */
async function handleNodeSelection(node, { expand }) {
  if (!node) return;
  setActiveNode(node.id);
  renderNodeDetails(node);
  if (expand && !node.expanded) {
    try {
      await ingestNode(node.endpoint, node.level ?? 1, { nodeId: node.id, originNode: node });
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
  const hostnameCandidates = [metadata.hostname, node.lastKnownHostname, metadata.node];
  const resolvedHostname = hostnameCandidates.find(
    (value) => typeof value === 'string' && value.trim().length,
  );
  const primaryIpCandidates = [
    metadata.primaryIp,
    metadata.primary_ip,
    metadata.primaryIP,
    node.lastLinkMetrics?.primaryIp,
    node.lastLinkMetrics?.ip,
    node.lastLinkMetrics?.ipAddress,
  ];
  const primaryIp = primaryIpCandidates.find(
    (value) => typeof value === 'string' && value.trim().length,
  );

  const entries = [
    ['Hostname', resolvedHostname ? resolveHostnameEndpoint(resolvedHostname) ?? resolvedHostname : 'N/A'],
    ['Primary IP', primaryIp ?? 'N/A'],
  ];

  const fragment = document.createDocumentFragment();
  entries.forEach(([label, value]) => {
    const dt = document.createElement('dt');
    dt.textContent = label;
    const dd = document.createElement('dd');
    dd.textContent = value ?? 'N/A';
    fragment.appendChild(dt);
    fragment.appendChild(dd);
  });
  dom.infoBody.replaceChildren(fragment);
}

function renderGraphStats(graphData) {
  if (!dom.graphStats) return;
  const data = graphData ?? state.getGraphData();
  const nodes = data.nodes ?? [];
  const links = data.links ?? [];
  const linkTypeCounts = links.reduce((acc, link) => {
    const raw = typeof link.linkType === 'string' ? link.linkType.trim() : '';
    const key = raw ? raw.toUpperCase() : 'UNSPECIFIED';
    acc[key] = (acc[key] ?? 0) + 1;
    return acc;
  }, {});

  const lines = [];
  lines.push({ text: `Nodes: ${nodes.length}`, indent: false });
  lines.push({ text: `Total Links: ${links.length}`, indent: false });

  const knownTypes = [
    ['WIREGUARD', 'WireGuard links'],
    ['DTD', 'DtD links'],
    ['RF', 'RF links'],
    ['XLINK', 'XLink links'],
  ];

  knownTypes.forEach(([type, label]) => {
    const quantity = linkTypeCounts[type] ?? 0;
    lines.push({ text: `${label}: ${quantity}`, indent: true });
    delete linkTypeCounts[type];
  });

  Object.keys(linkTypeCounts)
    .sort()
    .forEach((type) => {
      const label = type === 'UNSPECIFIED' ? 'Other links' : `${formatLinkTypeLabel(type)} links`;
      lines.push({ text: `${label}: ${linkTypeCounts[type]}`, indent: true });
    });

  const fragment = document.createDocumentFragment();
  lines.forEach((entry) => {
    const { text, indent } = typeof entry === 'string' ? { text: entry, indent: false } : entry;
    const row = document.createElement('p');
    row.classList.add('graph-stats__row');
    if (indent) {
      row.classList.add('graph-stats__row--indented');
    }
    row.textContent = text;
    fragment.appendChild(row);
  });
  dom.graphStats.replaceChildren(fragment);
}

function formatLinkTypeLabel(token) {
  if (!token) return 'Other';
  return token
    .toLowerCase()
    .split(/[_\s-]+/)
    .filter(Boolean)
    .map((segment) => segment.charAt(0).toUpperCase() + segment.slice(1))
    .join(' ');
}

/** Simple status badge helper. */
function setStatus(message, tone = 'info') {
  dom.status.textContent = message;
  dom.status.className = `graph-status status-${tone}`;
}
