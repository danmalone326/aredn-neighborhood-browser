/**
 * GraphState owns the canonical list of nodes and links shown in the graph.
 * It centralizes deduplication so UI/graph layers can stay stateless.
 */
export class GraphState {
  constructor() {
    this.nodes = new Map();
    this.links = new Map();
    this.aliases = new Map();
  }

  /** Reset graph back to pristine state. */
  reset() {
    this.nodes.clear();
    this.links.clear();
    this.aliases.clear();
  }

  /**
   * Insert or update a node.
   * @param {Object} node
   * @returns {Object} node record stored internally.
   */
  upsertNode(node) {
    const canonicalId = this.resolveNodeId(node.id) ?? node.id;
    const existing = this.nodes.get(canonicalId);
    if (existing) {
      const level = Math.min(existing.level ?? Infinity, node.level ?? Infinity);
      const type = level <= 1 ? 'local' : node.type ?? existing.type;
      Object.assign(existing, node, { id: canonicalId, level, type });
      this.registerAlias(existing.id, existing.id);
      (node.aliases ?? []).forEach((alias) => this.registerAlias(alias, existing.id));
      return existing;
    }

    const seededNode = {
      id: canonicalId,
      label: node.label ?? node.id,
      level: node.level ?? 0,
      type: node.type ?? 'local',
      endpoint: node.endpoint ?? node.id,
      metadata: node.metadata ?? {},
      expanded: node.expanded ?? false,
      loading: node.loading ?? false,
      failed: node.failed ?? false,
      manual: node.manual ?? false,
      x: node.x ?? Math.random() * 400,
      y: node.y ?? Math.random() * 400,
      vx: 0,
      vy: 0,
    };

    this.nodes.set(seededNode.id, seededNode);
    this.registerAlias(seededNode.id, seededNode.id);
    (node.aliases ?? []).forEach((alias) => this.registerAlias(alias, seededNode.id));
    return seededNode;
  }

  /**
   * Insert or update a link that connects two nodes.
   * @param {Object} link
   */
  upsertLink(link) {
    const pair = [link.source, link.target].sort();
    const key = `${pair[0]}<->${pair[1]}`;
    const payload = {
      id: key,
      source: pair[0],
      target: pair[1],
      kind: link.kind ?? 'local',
      styleClass: link.styleClass ?? 'link-default',
      linkType: link.linkType ?? null,
      metrics: link.metrics ?? {},
    };
    this.links.set(key, payload);
    return payload;
  }

  /** Mark a node as having been expanded (links fetched). */
  markExpanded(nodeId) {
    const resolved = this.resolveNodeId(nodeId) ?? nodeId;
    const node = this.nodes.get(resolved);
    if (node) {
      node.expanded = true;
    }
  }

  /**
   * Retrieve a node by ID.
   * @param {string} nodeId
   * @returns {Object|undefined}
   */
  getNode(nodeId) {
    const resolved = this.resolveNodeId(nodeId) ?? nodeId;
    return this.nodes.get(resolved);
  }

  /** Current graph snapshot, suitable for rendering. */
  getGraphData() {
    return {
      nodes: Array.from(this.nodes.values()),
      links: Array.from(this.links.values()),
    };
  }

  /**
   * Re-key a node to a new id, updating aliases and links.
   * If the new id already exists, merges old node data into it.
   * @param {string} oldId
   * @param {string} newId
   * @returns {Object|undefined}
   */
  rekeyNode(oldId, newId) {
    if (!oldId || !newId) return undefined;
    const resolvedOld = this.resolveNodeId(oldId) ?? oldId;
    const resolvedNew = this.resolveNodeId(newId) ?? newId;
    if (resolvedOld === resolvedNew) {
      return this.nodes.get(resolvedNew);
    }

    const oldNode = this.nodes.get(resolvedOld);
    const existingNew = this.nodes.get(resolvedNew);
    if (!oldNode && !existingNew) return undefined;

    if (existingNew && oldNode && existingNew !== oldNode) {
      const level = Math.min(existingNew.level ?? Infinity, oldNode.level ?? Infinity);
      const type = level <= 1 ? 'local' : existingNew.type ?? oldNode.type;
      Object.assign(existingNew, oldNode, {
        id: resolvedNew,
        level,
        type,
        metadata: { ...(oldNode.metadata ?? {}), ...(existingNew.metadata ?? {}) },
        expanded: existingNew.expanded || oldNode.expanded,
        loading: existingNew.loading || oldNode.loading,
        failed: existingNew.failed || oldNode.failed,
        manual: existingNew.manual || oldNode.manual,
      });
      this.nodes.delete(resolvedOld);
    } else if (!existingNew && oldNode) {
      this.nodes.delete(resolvedOld);
      oldNode.id = resolvedNew;
      this.nodes.set(resolvedNew, oldNode);
    }

    for (const [alias, id] of this.aliases.entries()) {
      if (id === resolvedOld) {
        this.aliases.set(alias, resolvedNew);
      }
    }
    this.registerAlias(resolvedOld, resolvedNew);
    this.registerAlias(resolvedNew, resolvedNew);

    const relinked = new Map();
    this.links.forEach((link) => {
      const source = link.source === resolvedOld ? resolvedNew : link.source;
      const target = link.target === resolvedOld ? resolvedNew : link.target;
      const pair = [source, target].sort();
      const key = `${pair[0]}<->${pair[1]}`;
      relinked.set(key, { ...link, id: key, source: pair[0], target: pair[1] });
    });
    this.links = relinked;

    return this.nodes.get(resolvedNew);
  }
  resolveNodeId(identifier) {
    if (!identifier) return undefined;
    if (this.nodes.has(identifier)) return identifier;
    return this.aliases.get(identifier);
  }

  registerAlias(identifier, nodeId) {
    if (!identifier || !nodeId) return;
    this.aliases.set(identifier, nodeId);
  }
}
