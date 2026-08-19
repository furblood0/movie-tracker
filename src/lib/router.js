/**
 * Cok kucuk bir yol yonlendirici (router).
 *
 * Desteklenen kalip sozdizimi:
 *   /api/entries          -> sabit yol
 *   /api/entries/:id      -> parametreli yol (ctx.params.id)
 *
 * Express YOK: kalip -> RegExp donusumu ile eslesme yapiliyor.
 */

/**
 * Kalibi (pattern) regex ve parametre adlarina cevirir.
 * @param {string} pattern
 */
function compilePattern(pattern) {
  /** @type {string[]} */
  const paramNames = [];

  const regexSource = pattern
    .split('/')
    .map((segment) => {
      if (segment === '') return '';
      if (segment.startsWith(':')) {
        paramNames.push(segment.slice(1));
        return '([^/]+)';
      }
      // Regex ozel karakterlerini kacir (literal segment)
      return segment.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    })
    .join('/');

  return { regex: new RegExp(`^${regexSource}/?$`), paramNames };
}

export function createRouter() {
  /** @type {{ method: string, regex: RegExp, paramNames: string[], handler: Function }[]} */
  const routes = [];

  function add(method, pattern, handler) {
    const { regex, paramNames } = compilePattern(pattern);
    routes.push({ method, regex, paramNames, handler });
  }

  return {
    get: (pattern, handler) => add('GET', pattern, handler),
    post: (pattern, handler) => add('POST', pattern, handler),
    put: (pattern, handler) => add('PUT', pattern, handler),
    patch: (pattern, handler) => add('PATCH', pattern, handler),
    delete: (pattern, handler) => add('DELETE', pattern, handler),

    /**
     * Yolu eslestirir.
     * @param {string} method
     * @param {string} pathname
     * @returns {{ handler: Function, params: Record<string, string> } | { allowedMethods: string[] } | null}
     *   - Eslesme varsa handler + params
     *   - Yol var ama metot yanlissa allowedMethods (405 icin)
     *   - Hic eslesme yoksa null (404 icin)
     */
    match(method, pathname) {
      /** @type {Set<string>} */
      const allowedMethods = new Set();

      for (const route of routes) {
        const matched = route.regex.exec(pathname);
        if (!matched) continue;

        if (route.method !== method) {
          allowedMethods.add(route.method);
          continue;
        }

        /** @type {Record<string, string>} */
        const params = {};
        route.paramNames.forEach((name, index) => {
          const rawValue = matched[index + 1];
          try {
            params[name] = decodeURIComponent(rawValue);
          } catch {
            params[name] = rawValue;
          }
        });

        return { handler: route.handler, params };
      }

      if (allowedMethods.size > 0) {
        // HEAD, GET destekleniyorsa otomatik olarak izinlidir.
        if (allowedMethods.has('GET')) allowedMethods.add('HEAD');
        allowedMethods.add('OPTIONS');
        return { allowedMethods: [...allowedMethods] };
      }
      return null;
    },
  };
}
