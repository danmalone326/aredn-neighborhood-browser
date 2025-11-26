/**
 * MeshApi encapsulates calls to an AREDN node for link information.
 * Using a dedicated class makes it easier to swap transport strategies
 * or augment with retries/caching in the future without touching callers.
 */
export class MeshApi {
  /**
   * @param {Object} [options]
   * @param {number} [options.timeoutMs=8000] - Hard request timeout.
   */
  constructor(options = {}) {
    this.timeoutMs = options.timeoutMs ?? 8000;
  }

  /**
   * Fetches link data for the provided host.
   * @param {string} host - hostname or IP of the target node.
   * @returns {Promise<Object>} Parsed JSON payload.
   */
  async fetchLinkInfo(host, options = {}) {
    const url = this.#buildUrl(host, options);
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), this.timeoutMs);

    try {
      const response = await fetch(url, { signal: controller.signal });
      if (!response.ok) {
        throw new Error(`Request failed with status ${response.status}`);
      }
      return await response.json();
    } catch (error) {
      if (error.name === 'AbortError') {
        throw new Error('Request timed out. Node may be offline or unreachable.');
      }
      throw error;
    } finally {
      clearTimeout(timeoutId);
    }
  }

  /**
   * Normalizes the user-supplied host into a request URL.
   * @param {string} host
   * @returns {string}
   */
  #buildUrl(host, options = {}) {
    const trimmed = host.trim();
    const prefixed = /^https?:\/\//i.test(trimmed) ? trimmed : `http://${trimmed}`;
    const sanitized = prefixed.replace(/\/$/, '');
    const base = `${sanitized}/cgi-bin/sysinfo.json?link_info=1`;
    return options.includeHosts ? `${base}&hosts=1` : base;
  }
}
