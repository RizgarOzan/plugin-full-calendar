/**
 * @jest-environment jsdom
 */
import { obsidianFetch } from '../obsidian-fetch_caldav';
import {
  normalizeCalDAVServerUrl,
  discoverCurrentUserPrincipal,
  discoverCalendarHomeSet,
  enumerateCalendarCollections,
  discoverCalDAVAccount
} from './caldavDiscovery';

jest.mock('../obsidian-fetch_caldav', () => ({
  obsidianFetch: jest.fn()
}));

const mockFetch = obsidianFetch as jest.MockedFunction<typeof obsidianFetch>;

describe('caldavDiscovery', () => {
  beforeEach(() => {
    mockFetch.mockReset();
  });

  describe('normalizeCalDAVServerUrl', () => {
    it('prefixes https:// to bare domain and ensures trailing slash', () => {
      expect(normalizeCalDAVServerUrl('caldav.fastmail.com')).toBe('https://caldav.fastmail.com/');
    });

    it('retains existing https protocol and path', () => {
      expect(
        normalizeCalDAVServerUrl(
          'https://caldav.fastmail.com/dav/principals/user/alice@example.com/'
        )
      ).toBe('https://caldav.fastmail.com/dav/principals/user/alice@example.com/');
    });

    it('throws on empty string', () => {
      expect(() => normalizeCalDAVServerUrl('   ')).toThrow('Server URL cannot be empty');
    });
  });

  describe('discoverCurrentUserPrincipal', () => {
    it('parses DAV:current-user-principal href', async () => {
      const xml = `<?xml version="1.0" encoding="utf-8"?>
<d:multistatus xmlns:d="DAV:">
  <d:response>
    <d:href>/</d:href>
    <d:propstat>
      <d:prop>
        <d:current-user-principal>
          <d:href>/dav/principals/user/alice@example.com/</d:href>
        </d:current-user-principal>
      </d:prop>
      <d:status>HTTP/1.1 200 OK</d:status>
    </d:propstat>
  </d:response>
</d:multistatus>`;

      mockFetch.mockResolvedValueOnce({
        status: 207,
        text: () => Promise.resolve(xml)
      } as Response);

      const principal = await discoverCurrentUserPrincipal('https://caldav.fastmail.com/');
      expect(principal).toBe('https://caldav.fastmail.com/dav/principals/user/alice@example.com/');
    });

    it('returns null if response status is not 2xx or principal not found', async () => {
      mockFetch.mockResolvedValueOnce({
        status: 404,
        text: () => Promise.resolve('')
      } as Response);

      const principal = await discoverCurrentUserPrincipal(
        'https://caldav.fastmail.com/.well-known/caldav'
      );
      expect(principal).toBeNull();
    });
  });

  describe('discoverCalendarHomeSet', () => {
    it('parses cal:calendar-home-set hrefs', async () => {
      const xml = `<?xml version="1.0" encoding="utf-8"?>
<d:multistatus xmlns:d="DAV:" xmlns:c="urn:ietf:params:xml:ns:caldav">
  <d:response>
    <d:href>/dav/principals/user/alice@example.com/</d:href>
    <d:propstat>
      <d:prop>
        <c:calendar-home-set>
          <d:href>/dav/calendars/user/alice@example.com/</d:href>
        </c:calendar-home-set>
      </d:prop>
      <d:status>HTTP/1.1 200 OK</d:status>
    </d:propstat>
  </d:response>
</d:multistatus>`;

      mockFetch.mockResolvedValueOnce({
        status: 207,
        text: () => Promise.resolve(xml)
      } as Response);

      const homeSets = await discoverCalendarHomeSet(
        'https://caldav.fastmail.com/dav/principals/user/alice@example.com/'
      );
      expect(homeSets).toEqual([
        'https://caldav.fastmail.com/dav/calendars/user/alice@example.com/'
      ]);
    });
  });

  describe('enumerateCalendarCollections', () => {
    it('extracts calendars and task collections with components, display names, and colors', async () => {
      const xml = `<?xml version="1.0" encoding="utf-8"?>
<d:multistatus xmlns:d="DAV:" xmlns:c="urn:ietf:params:xml:ns:caldav" xmlns:ical="http://apple.com/ns/ical/">
  <!-- Parent home set -->
  <d:response>
    <d:href>/dav/calendars/user/alice@example.com/</d:href>
    <d:propstat>
      <d:prop><d:resourcetype><d:collection/></d:resourcetype></d:prop>
      <d:status>HTTP/1.1 200 OK</d:status>
    </d:propstat>
  </d:response>

  <!-- Main Event Calendar -->
  <d:response>
    <d:href>/dav/calendars/user/alice@example.com/Default/</d:href>
    <d:propstat>
      <d:prop>
        <d:resourcetype><d:collection/><c:calendar/></d:resourcetype>
        <d:displayname>Personal</d:displayname>
        <c:supported-calendar-component-set>
          <c:comp name="VEVENT"/>
        </c:supported-calendar-component-set>
        <ical:calendar-color>#3A86FFFF</ical:calendar-color>
      </d:prop>
      <d:status>HTTP/1.1 200 OK</d:status>
    </d:propstat>
  </d:response>

  <!-- Task Collection 1: Habits -->
  <d:response>
    <d:href>/dav/calendars/user/alice@example.com/c1b2c3-habits/</d:href>
    <d:propstat>
      <d:prop>
        <d:resourcetype><d:collection/><c:calendar/></d:resourcetype>
        <d:displayname>Habits</d:displayname>
        <c:supported-calendar-component-set>
          <c:comp name="VTODO"/>
        </c:supported-calendar-component-set>
        <ical:calendar-color>#4CAF50</ical:calendar-color>
      </d:prop>
      <d:status>HTTP/1.1 200 OK</d:status>
    </d:propstat>
  </d:response>

  <!-- Task Collection 2: Work -->
  <d:response>
    <d:href>/dav/calendars/user/alice@example.com/c4d5e6-work/</d:href>
    <d:propstat>
      <d:prop>
        <d:resourcetype><d:collection/><c:calendar/></d:resourcetype>
        <d:displayname>Work Reminders</d:displayname>
        <c:supported-calendar-component-set>
          <c:comp name="VTODO"/>
        </c:supported-calendar-component-set>
      </d:prop>
      <d:status>HTTP/1.1 200 OK</d:status>
    </d:propstat>
  </d:response>
</d:multistatus>`;

      mockFetch.mockResolvedValueOnce({
        status: 207,
        text: () => Promise.resolve(xml)
      } as Response);

      const collections = await enumerateCalendarCollections(
        'https://caldav.fastmail.com/dav/calendars/user/alice@example.com/'
      );

      expect(collections).toHaveLength(3);

      expect(collections[0]).toEqual({
        href: 'https://caldav.fastmail.com/dav/calendars/user/alice@example.com/Default/',
        displayName: 'Personal',
        color: '#3A86FF',
        supportedComponents: ['VEVENT'],
        type: 'caldav',
        serverUrl: 'https://caldav.fastmail.com/'
      });

      expect(collections[1]).toEqual({
        href: 'https://caldav.fastmail.com/dav/calendars/user/alice@example.com/c1b2c3-habits/',
        displayName: 'Habits',
        color: '#4CAF50',
        supportedComponents: ['VTODO'],
        type: 'caldavtasks',
        serverUrl: 'https://caldav.fastmail.com/'
      });

      expect(collections[2]).toEqual({
        href: 'https://caldav.fastmail.com/dav/calendars/user/alice@example.com/c4d5e6-work/',
        displayName: 'Work Reminders',
        color: undefined,
        supportedComponents: ['VTODO'],
        type: 'caldavtasks',
        serverUrl: 'https://caldav.fastmail.com/'
      });
    });
  });

  describe('discoverCalDAVAccount', () => {
    it('handles direct collection URL immediately without requiring discovery', async () => {
      // PROPFIND on direct collection returns isCalendar: true
      const directXml = `<d:multistatus xmlns:d="DAV:" xmlns:c="urn:ietf:params:xml:ns:caldav" xmlns:ical="http://apple.com/ns/ical/">
  <d:response>
    <d:propstat>
      <d:prop>
        <d:resourcetype><d:collection/><c:calendar/></d:resourcetype>
        <d:displayname>Direct Tasks</d:displayname>
        <c:supported-calendar-component-set><c:comp name="VTODO"/></c:supported-calendar-component-set>
        <ical:calendar-color>#123456</ical:calendar-color>
      </d:prop>
      <d:status>HTTP/1.1 200 OK</d:status>
    </d:propstat>
  </d:response>
</d:multistatus>`;

      mockFetch.mockResolvedValueOnce({
        status: 207,
        text: () => Promise.resolve(directXml)
      } as Response);

      const results = await discoverCalDAVAccount({
        url: 'https://caldav.example.com/calendars/tasks/',
        username: 'u',
        password: 'p'
      });

      expect(results).toHaveLength(1);
      expect(results[0]).toMatchObject({
        href: 'https://caldav.example.com/calendars/tasks/',
        displayName: 'Direct Tasks',
        color: '#123456',
        type: 'caldavtasks'
      });
    });

    it('performs full 3-step discovery from account domain', async () => {
      // Step 1: Direct collection check fails (returns not a calendar)
      const nonCalXml = `<d:multistatus xmlns:d="DAV:">
  <d:response>
    <d:propstat>
      <d:prop><d:resourcetype><d:collection/></d:resourcetype></d:prop>
      <d:status>HTTP/1.1 200 OK</d:status>
    </d:propstat>
  </d:response>
</d:multistatus>`;
      mockFetch.mockResolvedValueOnce({
        status: 207,
        text: () => Promise.resolve(nonCalXml)
      } as Response);

      // Step 2: Direct calendar-home-set check fails (returns no calendar collections)
      mockFetch.mockResolvedValueOnce({
        status: 207,
        text: () => Promise.resolve(nonCalXml)
      } as Response);

      // Step 3: Principal home-set check fails (not a principal)
      mockFetch.mockResolvedValueOnce({
        status: 207,
        text: () => Promise.resolve(nonCalXml)
      } as Response);

      // Step 4: Well-known endpoint returns current-user-principal
      const principalXml = `<d:multistatus xmlns:d="DAV:">
  <d:response>
    <d:propstat>
      <d:prop>
        <d:current-user-principal>
          <d:href>/dav/principals/user/bob@fastmail.com/</d:href>
        </d:current-user-principal>
      </d:prop>
      <d:status>HTTP/1.1 200 OK</d:status>
    </d:propstat>
  </d:response>
</d:multistatus>`;
      mockFetch.mockResolvedValueOnce({
        status: 207,
        text: () => Promise.resolve(principalXml)
      } as Response);

      // Step 5: Principal returns calendar-home-set
      const homeSetXml = `<d:multistatus xmlns:d="DAV:" xmlns:c="urn:ietf:params:xml:ns:caldav">
  <d:response>
    <d:propstat>
      <d:prop>
        <c:calendar-home-set>
          <d:href>/dav/calendars/user/bob@fastmail.com/</d:href>
        </c:calendar-home-set>
      </d:prop>
      <d:status>HTTP/1.1 200 OK</d:status>
    </d:propstat>
  </d:response>
</d:multistatus>`;
      mockFetch.mockResolvedValueOnce({
        status: 207,
        text: () => Promise.resolve(homeSetXml)
      } as Response);

      // Step 6: Home-set Depth 1 returns collections
      const collectionsXml = `<d:multistatus xmlns:d="DAV:" xmlns:c="urn:ietf:params:xml:ns:caldav" xmlns:ical="http://apple.com/ns/ical/">
  <d:response>
    <d:href>/dav/calendars/user/bob@fastmail.com/calendar/</d:href>
    <d:propstat>
      <d:prop>
        <d:resourcetype><d:collection/><c:calendar/></d:resourcetype>
        <d:displayname>Bob Calendar</d:displayname>
        <c:supported-calendar-component-set><c:comp name="VEVENT"/></c:supported-calendar-component-set>
      </d:prop>
      <d:status>HTTP/1.1 200 OK</d:status>
    </d:propstat>
  </d:response>
  <d:response>
    <d:href>/dav/calendars/user/bob@fastmail.com/habits/</d:href>
    <d:propstat>
      <d:prop>
        <d:resourcetype><d:collection/><c:calendar/></d:resourcetype>
        <d:displayname>Habits</d:displayname>
        <c:supported-calendar-component-set><c:comp name="VTODO"/></c:supported-calendar-component-set>
      </d:prop>
      <d:status>HTTP/1.1 200 OK</d:status>
    </d:propstat>
  </d:response>
</d:multistatus>`;
      mockFetch.mockResolvedValueOnce({
        status: 207,
        text: () => Promise.resolve(collectionsXml)
      } as Response);

      const results = await discoverCalDAVAccount({
        url: 'caldav.fastmail.com',
        username: 'bob@fastmail.com',
        password: 'secret-password'
      });

      expect(results).toHaveLength(2);
      expect(results[0].displayName).toBe('Bob Calendar');
      expect(results[0].type).toBe('caldav');
      expect(results[1].displayName).toBe('Habits');
      expect(results[1].type).toBe('caldavtasks');
    });
  });
});
