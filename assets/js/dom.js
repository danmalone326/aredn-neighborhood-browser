export function createSimIndicator() {
  const container = document.createElement('div');
  container.classList.add('sim-indicator');
  container.id = 'sim-indicator';
  container.setAttribute('role', 'status');
  container.setAttribute('aria-live', 'polite');

  const light = document.createElement('span');
  light.classList.add('sim-light');
  light.setAttribute('title', 'Layout settling…');

  container.appendChild(light);
  return { container, light };
}
