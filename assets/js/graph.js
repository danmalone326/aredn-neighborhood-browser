const SVG_NS = 'http://www.w3.org/2000/svg';
const DEFAULT_OPTIONS = {
  repulsion: 6500,
  springLength: 70,
  springStrength: 0.01,
  damping: 0.9,
  worldMargin: 600,
};

/**
 * GraphRenderer handles the force simulation and DOM painting for the SVG graph.
 * It purposefully stays UI-framework agnostic so it can be reused with any shell.
 */
export class GraphRenderer {
  #boundPointerMove;
  #boundPointerUp;

  constructor(svgElement, options = {}) {
    this.svg = svgElement;
    this.options = { ...DEFAULT_OPTIONS, ...options };
    this.nodes = [];
    this.links = [];
    this.linkElements = [];
    this.nodeElements = [];
    this.activeNodeId = null;
    this.running = false;

    this.callbacks = {
      onNodeClick: options.onNodeClick ?? (() => {}),
    };

    this.sceneGroup = document.createElementNS(SVG_NS, 'g');
    this.linkLayer = document.createElementNS(SVG_NS, 'g');
    this.nodeLayer = document.createElementNS(SVG_NS, 'g');
    this.sceneGroup.appendChild(this.linkLayer);
    this.sceneGroup.appendChild(this.nodeLayer);
    this.svg.appendChild(this.sceneGroup);

    this.zoom = {
      scale: 1,
      min: 0.4,
      max: 2.5,
      translateX: 0,
      translateY: 0,
    };
    this.isPanning = false;
    this.panStart = null;
    this.#boundPointerMove = (event) => this.#onPointerMove(event);
    this.#boundPointerUp = (event) => this.#endPan(event);

    this.svg.addEventListener('wheel', (event) => this.#handleWheel(event), { passive: false });
    this.svg.addEventListener('pointerdown', (event) => this.#beginPan(event));

    window.addEventListener('resize', () => this.#syncViewport());
    this.#syncViewport();
  }

  /**
   * Replace the currently rendered nodes/links with a new snapshot.
   * The renderer keeps references to the objects from GraphState so
   * position updates persist across re-syncs.
   */
  sync(data) {
    this.nodes = data.nodes ?? [];
    this.links = data.links ?? [];
    this.#renderLinks();
    this.#renderNodes();
    this.#ensureAnimation();
  }

  /** Highlight a node to show selection feedback. */
  setActiveNode(nodeId) {
    this.activeNodeId = nodeId;
    this.nodeElements.forEach((entry) => {
      if (!entry?.circle) return;
      if (entry.node.id === nodeId) {
        entry.circle.classList.add('node-active');
        this.#bringGroupToFront(entry.group);
      } else {
        entry.circle.classList.remove('node-active');
      }
    });
  }

  /** Recalculate SVG dimensions after layout changes. */
  #syncViewport() {
    const rect = this.svg.getBoundingClientRect();
    if (rect.width && rect.height) {
      this.width = rect.width;
      this.height = rect.height;
    } else {
      this.width = this.width ?? 800;
      this.height = this.height ?? 600;
    }
    this.svg.setAttribute('viewBox', `0 0 ${this.width} ${this.height}`);
    this.#applyTransform();
  }

  #renderLinks() {
    while (this.linkLayer.firstChild) {
      this.linkLayer.removeChild(this.linkLayer.firstChild);
    }
    this.linkElements = this.links.map((link) => {
      const line = document.createElementNS(SVG_NS, 'line');
      const className = link.styleClass ?? 'link-default';
      line.classList.add('link-segment', className);
      this.linkLayer.appendChild(line);
      return { line, link };
    });
  }

  #renderNodes() {
    while (this.nodeLayer.firstChild) {
      this.nodeLayer.removeChild(this.nodeLayer.firstChild);
    }

    this.nodeElements = this.nodes.map((node) => {
      const group = document.createElementNS(SVG_NS, 'g');
      group.classList.add('node-group');
      const circle = document.createElementNS(SVG_NS, 'circle');
      const label = document.createElementNS(SVG_NS, 'text');

      circle.setAttribute('r', node.level === 0 ? '12' : '9');
      circle.classList.add(node.level === 0 ? 'node-root' : 'node-peer');

      label.classList.add('node-label');
      label.textContent = node.label;

      circle.addEventListener('click', (event) => {
        event.stopPropagation();
        this.setActiveNode(node.id);
        this.callbacks.onNodeClick(node);
      });

      group.addEventListener('mouseenter', () => {
        group.classList.add('node-hover');
        this.#bringGroupToFront(group);
      });
      group.addEventListener('mouseleave', () => {
        group.classList.remove('node-hover');
      });

      group.appendChild(circle);
      group.appendChild(label);
      this.nodeLayer.appendChild(group);

      return { group, circle, label, node };
    });
  }

  #ensureAnimation() {
    if (this.running) return;
    this.running = true;
    const tick = () => {
      if (!this.running) return;
      this.#stepSimulation();
      this.#drawFrame();
      this.frameHandle = requestAnimationFrame(tick);
    };
    this.frameHandle = requestAnimationFrame(tick);
  }

  #stepSimulation() {
    const nodes = this.nodes;
    const links = this.links;
    const { repulsion, springLength, springStrength, damping } = this.options;
    const centerX = (this.width ?? 800) / 2;
    const centerY = (this.height ?? 600) / 2;
    const nodeMap = new Map(nodes.map((node) => [node.id, node]));

    // 1) Apply Coulomb-style repulsion so nodes spread apart.
    for (let i = 0; i < nodes.length; i += 1) {
      const nodeA = nodes[i];
      if (nodeA.x == null || nodeA.y == null) {
        nodeA.x = centerX + Math.random() * 40 - 20;
        nodeA.y = centerY + Math.random() * 40 - 20;
      }
      for (let j = i + 1; j < nodes.length; j += 1) {
        const nodeB = nodes[j];
        const dx = nodeB.x - nodeA.x;
        const dy = nodeB.y - nodeA.y;
        const distance = Math.max(Math.hypot(dx, dy), 1);
        const force = repulsion / (distance * distance);
        const fx = (force * dx) / distance;
        const fy = (force * dy) / distance;
        nodeA.vx -= fx;
        nodeA.vy -= fy;
        nodeB.vx += fx;
        nodeB.vy += fy;
      }
    }

    // 2) Apply spring force so linked nodes stay within a reasonable distance.
    links.forEach((link) => {
      const source = nodeMap.get(link.source);
      const target = nodeMap.get(link.target);
      if (!source || !target) return;
      const dx = target.x - source.x;
      const dy = target.y - source.y;
      const distance = Math.max(Math.hypot(dx, dy), 1);
      const displacement = distance - springLength;
      const force = springStrength * displacement;
      const fx = (force * dx) / distance;
      const fy = (force * dy) / distance;
      source.vx += fx;
      source.vy += fy;
      target.vx -= fx;
      target.vy -= fy;
    });

    // 3) Pull nodes back toward the viewport center and integrate velocity.
    const margin = this.options.worldMargin ?? 0;
    const minX = 0 - margin;
    const maxX = (this.width ?? 800) + margin;
    const minY = 0 - margin;
    const maxY = (this.height ?? 600) + margin;

    nodes.forEach((node) => {
      const dx = centerX - node.x;
      const dy = centerY - node.y;
      node.vx += dx * 0.0015;
      node.vy += dy * 0.0015;

      node.vx *= damping;
      node.vy *= damping;
      node.x += node.vx;
      node.y += node.vy;

      node.x = this.#quantize(Math.min(Math.max(node.x, minX), maxX));
      node.y = this.#quantize(Math.min(Math.max(node.y, minY), maxY));
      node.vx = this.#quantize(node.vx, 6);
      node.vy = this.#quantize(node.vy, 6);
    });
  }

  #drawFrame() {
    if (!this.nodeElements.length) return;
    const nodeMap = new Map(this.nodes.map((node) => [node.id, node]));
    this.linkElements.forEach(({ line, link }) => {
      const source = nodeMap.get(link.source);
      const target = nodeMap.get(link.target);
      if (!source || !target) return;
      line.setAttribute('x1', source.x);
      line.setAttribute('y1', source.y);
      line.setAttribute('x2', target.x);
      line.setAttribute('y2', target.y);
    });

    this.nodeElements.forEach((entry) => {
      const { circle, label, node } = entry;
      circle.setAttribute('cx', node.x);
      circle.setAttribute('cy', node.y);
      label.setAttribute('x', node.x + 14);
      label.setAttribute('y', node.y + 4);
    });
  }

  #applyTransform() {
    const { translateX, translateY, scale } = this.zoom;
    this.sceneGroup.setAttribute(
      'transform',
      `translate(${translateX} ${translateY}) scale(${scale})`,
    );
  }

  #handleWheel(event) {
    event.preventDefault();
    const { offsetX, offsetY, deltaY } = event;
    const zoomFactor = deltaY < 0 ? 1.1 : 0.9;
    const newScale = Math.min(Math.max(this.zoom.scale * zoomFactor, this.zoom.min), this.zoom.max);
    const scaleRatio = newScale / this.zoom.scale;

    const dx = offsetX - this.zoom.translateX;
    const dy = offsetY - this.zoom.translateY;
    this.zoom.translateX = offsetX - dx * scaleRatio;
    this.zoom.translateY = offsetY - dy * scaleRatio;
    this.zoom.scale = newScale;
    this.#applyTransform();
  }

  #beginPan(event) {
    if (event.button !== 0 || event.target !== this.svg) return;
    this.isPanning = true;
    this.panStart = {
      pointerId: event.pointerId,
      x: event.clientX,
      y: event.clientY,
      translateX: this.zoom.translateX,
      translateY: this.zoom.translateY,
    };
    this.svg.setPointerCapture(event.pointerId);
    this.svg.addEventListener('pointermove', this.#boundPointerMove);
    this.svg.addEventListener('pointerup', this.#boundPointerUp);
    this.svg.addEventListener('pointercancel', this.#boundPointerUp);
  }

  #onPointerMove(event) {
    if (!this.isPanning || event.pointerId !== this.panStart.pointerId) return;
    const dx = event.clientX - this.panStart.x;
    const dy = event.clientY - this.panStart.y;
    this.zoom.translateX = this.panStart.translateX + dx;
    this.zoom.translateY = this.panStart.translateY + dy;
    this.#applyTransform();
  }

  #endPan(event) {
    if (!this.isPanning || event.pointerId !== this.panStart.pointerId) return;
    this.isPanning = false;
    this.svg.releasePointerCapture(event.pointerId);
    this.svg.removeEventListener('pointermove', this.#boundPointerMove);
    this.svg.removeEventListener('pointerup', this.#boundPointerUp);
    this.svg.removeEventListener('pointercancel', this.#boundPointerUp);
    this.panStart = null;
  }

  #quantize(value, decimals = 5) {
    const factor = 10 ** decimals;
    return Math.round(value * factor) / factor;
  }

  #bringGroupToFront(group) {
    if (!group || group.parentNode !== this.nodeLayer) return;
    this.nodeLayer.appendChild(group);
  }
}
