import { obsidianFetch } from '../obsidian-fetch_caldav';
import { createBasicAuthHeader } from '../auth/auth_caldav';
import {
  canonCollection,
  ensureTrailingSlash,
  fetchCalendarInfo,
  splitCalDAVUrl
} from './helper_caldav';
import { ensureXmlDocument } from './caldavClient';

export interface DiscoveredCalDAVCollection {
  href: string; // Absolute collection URL
  displayName: string;
  color?: string;
  supportedComponents: ('VEVENT' | 'VTODO' | 'VJOURNAL')[];
  type: 'caldav' | 'caldavtasks' | 'both';
  serverUrl: string;
}

export function normalizeCalDAVServerUrl(input: string): string {
  let trimmed = input.trim();
  if (!trimmed) {
    throw new Error('Server URL cannot be empty.');
  }
  if (!/^https?:\/\//i.test(trimmed)) {
    trimmed = `https://${trimmed}`;
  }
  try {
    const parsed = new URL(trimmed);
    if (!parsed.pathname || parsed.pathname === '') {
      parsed.pathname = '/';
    }
    return parsed.toString();
  } catch {
    return ensureTrailingSlash(trimmed);
  }
}

export function resolveUrl(base: string, pathOrUrl: string): string {
  try {
    return new URL(pathOrUrl, base).toString();
  } catch {
    return pathOrUrl;
  }
}

/**
 * Extracts the href text from an XML element, handling namespace prefixes.
 */
function getHrefFromElement(el: Element): string | null {
  const hrefNodes = el.getElementsByTagNameNS('DAV:', 'href');
  if (hrefNodes.length > 0 && hrefNodes[0].textContent) {
    return hrefNodes[0].textContent.trim();
  }
  const wildcardNodes = el.getElementsByTagNameNS('*', 'href');
  if (wildcardNodes.length > 0 && wildcardNodes[0].textContent) {
    return wildcardNodes[0].textContent.trim();
  }
  return null;
}

/**
 * Discovers the current user principal URL using RFC 5397 / RFC 6764.
 */
export async function discoverCurrentUserPrincipal(
  url: string,
  authHeader?: string
): Promise<string | null> {
  const headers: Record<string, string> = {
    Depth: '0',
    'Content-Type': 'application/xml; charset=utf-8',
    Accept: '*/*'
  };
  if (authHeader) {
    headers['Authorization'] = authHeader;
  }

  const body = `<?xml version="1.0" encoding="utf-8" ?>
<d:propfind xmlns:d="DAV:">
  <d:prop>
    <d:current-user-principal />
  </d:prop>
</d:propfind>`;

  try {
    const res = await obsidianFetch(url, { method: 'PROPFIND', headers, body });
    if (res.status >= 200 && res.status < 300) {
      const xml = await res.text();
      const doc = ensureXmlDocument(xml, 'CalDAV Principal Discovery');
      const principalNodes = doc.getElementsByTagNameNS('DAV:', 'current-user-principal');
      const node =
        principalNodes.length > 0
          ? principalNodes[0]
          : doc.getElementsByTagNameNS('*', 'current-user-principal')[0];
      if (node) {
        const href = getHrefFromElement(node);
        if (href) {
          return resolveUrl(url, href);
        }
      }
    }
  } catch {
    // Principal query failed on candidate endpoint
  }
  return null;
}

/**
 * Discovers calendar home sets on a principal URL using RFC 4791 §6.2.1.
 */
export async function discoverCalendarHomeSet(
  principalUrl: string,
  authHeader?: string
): Promise<string[]> {
  const headers: Record<string, string> = {
    Depth: '0',
    'Content-Type': 'application/xml; charset=utf-8',
    Accept: '*/*'
  };
  if (authHeader) {
    headers['Authorization'] = authHeader;
  }

  const body = `<?xml version="1.0" encoding="utf-8" ?>
<d:propfind xmlns:d="DAV:" xmlns:c="urn:ietf:params:xml:ns:caldav">
  <d:prop>
    <c:calendar-home-set />
  </d:prop>
</d:propfind>`;

  try {
    const res = await obsidianFetch(principalUrl, { method: 'PROPFIND', headers, body });
    if (res.status >= 200 && res.status < 300) {
      const xml = await res.text();
      const doc = ensureXmlDocument(xml, 'CalDAV Home-Set Discovery');
      const homeSetNodes = doc.getElementsByTagNameNS(
        'urn:ietf:params:xml:ns:caldav',
        'calendar-home-set'
      );
      const candidateNodes =
        homeSetNodes.length > 0
          ? Array.from(homeSetNodes)
          : Array.from(doc.getElementsByTagNameNS('*', 'calendar-home-set'));

      const homeUrls: string[] = [];
      for (const node of candidateNodes) {
        const hrefNodes = Array.from(node.getElementsByTagNameNS('DAV:', 'href')).concat(
          Array.from(node.getElementsByTagNameNS('*', 'href'))
        );
        for (const h of hrefNodes) {
          const text = h.textContent?.trim();
          if (text) {
            homeUrls.push(ensureTrailingSlash(resolveUrl(principalUrl, text)));
          }
        }
      }
      if (homeUrls.length > 0) {
        return Array.from(new Set(homeUrls));
      }
    }
  } catch {
    // Home set query failed
  }
  return [];
}

/**
 * Enumerates all calendar/task collections inside a calendar-home-set URL using RFC 4791 §5.2.
 */
export async function enumerateCalendarCollections(
  homeSetUrl: string,
  authHeader?: string
): Promise<DiscoveredCalDAVCollection[]> {
  const headers: Record<string, string> = {
    Depth: '1',
    'Content-Type': 'application/xml; charset=utf-8',
    Accept: '*/*'
  };
  if (authHeader) {
    headers['Authorization'] = authHeader;
  }

  const body = `<?xml version="1.0" encoding="utf-8" ?>
<d:propfind xmlns:d="DAV:" xmlns:c="urn:ietf:params:xml:ns:caldav" xmlns:ical="http://apple.com/ns/ical/">
  <d:prop>
    <d:resourcetype />
    <d:displayname />
    <c:supported-calendar-component-set />
    <ical:calendar-color />
  </d:prop>
</d:propfind>`;

  const res = await obsidianFetch(canonCollection(homeSetUrl), {
    method: 'PROPFIND',
    headers,
    body
  });
  if (res.status < 200 || res.status >= 300) {
    return [];
  }

  const xml = await res.text();
  const doc = ensureXmlDocument(xml, 'CalDAV Collection Enumeration');
  const responses = Array.from(doc.getElementsByTagNameNS('*', 'response'));
  const results: DiscoveredCalDAVCollection[] = [];
  const { serverUrl } = splitCalDAVUrl(homeSetUrl);
  const normalizedHome = ensureTrailingSlash(homeSetUrl);

  for (const resp of responses) {
    const href = getHrefFromElement(resp);
    if (!href) continue;

    const fullUrl = ensureTrailingSlash(resolveUrl(homeSetUrl, href));

    // Check propstats for successful properties
    const propstats = Array.from(resp.getElementsByTagNameNS('*', 'propstat'));
    let propNode: Element | null = null;
    for (const ps of propstats) {
      const statusText = ps.getElementsByTagNameNS('*', 'status')[0]?.textContent || '';
      if (/HTTP\/\d(?:\.\d)?\s+2\d\d/i.test(statusText)) {
        propNode = ps.getElementsByTagNameNS('*', 'prop')[0] || null;
        if (propNode) break;
      }
    }
    if (!propNode) continue;

    // Check resourcetype: must have <calendar/>
    const resourceTypeNode = propNode.getElementsByTagNameNS('*', 'resourcetype')[0];
    if (!resourceTypeNode) continue;

    const hasCalendarTag =
      resourceTypeNode.getElementsByTagNameNS('urn:ietf:params:xml:ns:caldav', 'calendar').length >
        0 || resourceTypeNode.getElementsByTagNameNS('*', 'calendar').length > 0;

    if (!hasCalendarTag) {
      continue;
    }

    // Don't skip if the home-set itself happens to be a calendar, but usually skip if it's the parent collection
    if (fullUrl === normalizedHome && responses.length > 1) {
      // If home collection itself is reported, skip if it has children
      continue;
    }

    // Extract displayname
    const displayNameNode = propNode.getElementsByTagNameNS('*', 'displayname')[0];
    let displayName = displayNameNode?.textContent?.trim();
    if (!displayName) {
      // Derive fallback name from last non-empty path segment
      const segments = fullUrl.replace(/\/+$/, '').split('/');
      displayName = decodeURIComponent(segments[segments.length - 1] || 'Calendar');
    }

    // Extract color
    const colorNode = propNode.getElementsByTagNameNS('*', 'calendar-color')[0];
    let color: string | undefined;
    if (colorNode?.textContent?.trim()) {
      const rawColor = colorNode.textContent.trim();
      color = rawColor.replace(/^(?!#)/, '#').match(/^#[0-9A-Fa-f]{6}/)?.[0];
    }

    // Extract supported components
    const componentSetNode = propNode.getElementsByTagNameNS(
      '*',
      'supported-calendar-component-set'
    )[0];
    let supportedComponents: ('VEVENT' | 'VTODO' | 'VJOURNAL')[] = [];
    if (componentSetNode) {
      const compNodes = Array.from(componentSetNode.getElementsByTagNameNS('*', 'comp'));
      supportedComponents = compNodes
        .map(c => c.getAttribute('name')?.toUpperCase())
        .filter(
          (c): c is 'VEVENT' | 'VTODO' | 'VJOURNAL' =>
            c === 'VEVENT' || c === 'VTODO' || c === 'VJOURNAL'
        );
    }

    // If omitted, RFC 4791 specifies that all components are supported by default
    if (supportedComponents.length === 0) {
      supportedComponents = ['VEVENT', 'VTODO'];
    }

    const hasVEvent = supportedComponents.includes('VEVENT');
    const hasVTodo = supportedComponents.includes('VTODO');

    const type: 'caldav' | 'caldavtasks' | 'both' =
      hasVEvent && !hasVTodo ? 'caldav' : hasVTodo && !hasVEvent ? 'caldavtasks' : 'both';

    results.push({
      href: fullUrl,
      displayName,
      color,
      supportedComponents,
      type,
      serverUrl
    });
  }

  return results;
}

/**
 * Top-level auto-discovery function for CalDAV accounts.
 * Connects standard CalDAV discovery sequence:
 * 1. Checks if the URL is already a direct calendar collection.
 * 2. Checks if the URL is a calendar-home-set.
 * 3. Checks if the URL is a principal URL.
 * 4. Resolves principal via /.well-known/caldav or / and retrieves collections.
 */
export async function discoverCalDAVAccount(options: {
  url: string;
  username?: string;
  password?: string;
}): Promise<DiscoveredCalDAVCollection[]> {
  const normalizedUrl = normalizeCalDAVServerUrl(options.url);
  const authHeader = createBasicAuthHeader(options.username, options.password);

  // 1. Direct Collection Check
  const directInfo = await fetchCalendarInfo(normalizedUrl, {
    username: options.username,
    password: options.password
  });
  if (directInfo.isCalendar) {
    const { serverUrl } = splitCalDAVUrl(normalizedUrl);
    const comps = (directInfo.supportedComponents as ('VEVENT' | 'VTODO' | 'VJOURNAL')[]) || [
      'VEVENT',
      'VTODO'
    ];
    const type =
      comps.includes('VTODO') && !comps.includes('VEVENT')
        ? 'caldavtasks'
        : comps.includes('VEVENT') && !comps.includes('VTODO')
          ? 'caldav'
          : 'both';
    return [
      {
        href: canonCollection(normalizedUrl),
        displayName: directInfo.displayName || 'CalDAV Calendar',
        color: directInfo.color,
        supportedComponents: comps,
        type,
        serverUrl
      }
    ];
  }

  // 2. Direct Calendar Home Set Check
  try {
    const homeCollections = await enumerateCalendarCollections(normalizedUrl, authHeader);
    if (homeCollections.length > 0) {
      return homeCollections;
    }
  } catch {
    // Continue to principal resolution
  }

  // 3. Principal Home-Set Check
  try {
    const homeSets = await discoverCalendarHomeSet(normalizedUrl, authHeader);
    if (homeSets.length > 0) {
      const allCols: DiscoveredCalDAVCollection[] = [];
      for (const hs of homeSets) {
        const cols = await enumerateCalendarCollections(hs, authHeader);
        allCols.push(...cols);
      }
      if (allCols.length > 0) {
        return allCols;
      }
    }
  } catch {
    // Continue to full principal discovery
  }

  // 4. Well-Known & Root Discovery (RFC 6764 & RFC 5397)
  const candidatePrincipalEndpoints = [
    resolveUrl(normalizedUrl, '/.well-known/caldav'),
    resolveUrl(normalizedUrl, '/'),
    normalizedUrl
  ];

  let principalUrl: string | null = null;
  for (const endpoint of candidatePrincipalEndpoints) {
    principalUrl = await discoverCurrentUserPrincipal(endpoint, authHeader);
    if (principalUrl) {
      break;
    }
  }

  if (principalUrl) {
    const homeSets = await discoverCalendarHomeSet(principalUrl, authHeader);
    if (homeSets.length > 0) {
      const allCols: DiscoveredCalDAVCollection[] = [];
      for (const hs of homeSets) {
        const cols = await enumerateCalendarCollections(hs, authHeader);
        allCols.push(...cols);
      }
      if (allCols.length > 0) {
        return allCols;
      }
    }
  }

  // If Fastmail-like path pattern is present, try /dav/calendars/user/<email>/ as fallback
  if (options.username && options.username.includes('@')) {
    try {
      const guessedFastmailHome = resolveUrl(
        normalizedUrl,
        `/dav/calendars/user/${encodeURIComponent(options.username)}/`
      );
      const cols = await enumerateCalendarCollections(guessedFastmailHome, authHeader);
      if (cols.length > 0) {
        return cols;
      }
    } catch {
      // Ignored
    }
  }

  return [];
}
