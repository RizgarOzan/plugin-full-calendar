import { rrulestr } from 'rrule';
import ical from 'ical.js';
import {
  parseTimezoneAwareString,
  patchRRuleTimezoneExpansion,
  resetRRulePatchStateForTests,
  resolveEffectiveTimezone,
  resolveSourceZone,
  RRuleDateEnvLike,
  RRuleExpandData,
  RRuleFrameRange,
  RRulePluginLike,
  RRuleSetLike
} from './Timezone';

type TestRRuleSet = RRuleSetLike & {
  _dtstart?: Date;
  dtstart?: () => Date;
  between?: (after: Date, before: Date, inc?: boolean) => Date[];
};

function createDateEnv(): RRuleDateEnvLike {
  return {
    toDate: (input: Date | string | number) => new Date(input),
    createMarker: (input: Date | string | number) => new Date(input)
  };
}

describe('patchRRuleTimezoneExpansion', () => {
  beforeEach(() => {
    resetRRulePatchStateForTests();
  });

  it('uses raw rruleSet.between dates and keeps Friday 18:00 in Asia/Shanghai', () => {
    const originalExpand = jest.fn<Date[], [RRuleExpandData, RRuleFrameRange, RRuleDateEnvLike]>(
      () => [new Date('2026-03-07T02:00:00.000Z')]
    );

    const plugin: RRulePluginLike = {
      recurringTypes: [{ expand: originalExpand }]
    };

    patchRRuleTimezoneExpansion(plugin, 'Asia/Shanghai');

    const between = jest.fn<Date[], [Date, Date, boolean?]>(() => [
      new Date('2026-03-06T18:00:00.000Z')
    ]);

    const errd: RRuleExpandData = {
      rruleSet: {
        tzid: () => 'Asia/Shanghai',
        _dtstart: new Date('2026-02-06T18:00:00.000Z'),
        between
      } as TestRRuleSet
    };

    const frameRange: RRuleFrameRange = {
      start: new Date('2026-03-01T00:00:00.000Z'),
      end: new Date('2026-03-31T00:00:00.000Z')
    };

    const expanded = plugin.recurringTypes[0].expand(errd, frameRange, createDateEnv());

    expect(between).toHaveBeenCalledTimes(1);
    expect(expanded).toHaveLength(1);
    // FullCalendar DateMarkers express wall-clock time in UTC fields:
    expect(expanded[0].toISOString()).toBe('2026-03-06T18:00:00.000Z');
    expect(expanded[0].getUTCDay()).toBe(5);
    expect(expanded[0].getUTCHours()).toBe(18);
  });

  it('fixes recurring event at 14:30 in America/Sao_Paulo (UTC-3) displaying at 14:30 instead of 17:30 UTC', () => {
    const originalExpand = jest.fn<Date[], [RRuleExpandData, RRuleFrameRange, RRuleDateEnvLike]>();
    const plugin: RRulePluginLike = {
      recurringTypes: [{ expand: originalExpand }]
    };

    patchRRuleTimezoneExpansion(plugin, 'America/Sao_Paulo');

    // rrule.js encodes DTSTART wall-clock time in UTC fields: 2026-04-16 14:30:00
    const between = jest.fn<Date[], [Date, Date, boolean?]>(() => [
      new Date(Date.UTC(2026, 3, 16, 14, 30, 0))
    ]);

    const errd: RRuleExpandData = {
      rruleSet: {
        tzid: () => 'America/Sao_Paulo',
        _dtstart: new Date(Date.UTC(2026, 3, 16, 14, 30, 0)),
        between
      } as TestRRuleSet
    };

    const frameRange: RRuleFrameRange = {
      start: new Date('2026-04-01T00:00:00.000Z'),
      end: new Date('2026-04-30T00:00:00.000Z')
    };

    const expanded = plugin.recurringTypes[0].expand(errd, frameRange, createDateEnv());

    expect(expanded).toHaveLength(1);
    // Crucial fix: must render at 14:30 (DateMarker UTC fields = 14:30), NOT 17:30 UTC!
    expect(expanded[0].toISOString()).toBe('2026-04-16T14:30:00.000Z');
    expect(expanded[0].getUTCHours()).toBe(14);
    expect(expanded[0].getUTCMinutes()).toBe(30);
  });

  it('correctly handles quoted TZID (e.g. DTSTART;TZID="America/Sao_Paulo")', () => {
    const plugin: RRulePluginLike = {
      recurringTypes: [
        { expand: jest.fn<Date[], [RRuleExpandData, RRuleFrameRange, RRuleDateEnvLike]>() }
      ]
    };

    patchRRuleTimezoneExpansion(plugin, 'America/Sao_Paulo');

    const errd: RRuleExpandData = {
      rruleSet: {
        tzid: () => '"America/Sao_Paulo"',
        _dtstart: new Date(Date.UTC(2026, 3, 16, 14, 30, 0)),
        between: () => [new Date(Date.UTC(2026, 3, 16, 14, 30, 0))]
      } as TestRRuleSet
    };

    const expanded = plugin.recurringTypes[0].expand(
      errd,
      { start: new Date('2026-04-01T00:00:00Z'), end: new Date('2026-04-30T00:00:00Z') },
      createDateEnv()
    );

    expect(expanded).toHaveLength(1);
    expect(expanded[0].toISOString()).toBe('2026-04-16T14:30:00.000Z');
  });

  it('correctly normalizes Windows timezone identifiers (e.g. E. South America Standard Time)', () => {
    const plugin: RRulePluginLike = {
      recurringTypes: [
        { expand: jest.fn<Date[], [RRuleExpandData, RRuleFrameRange, RRuleDateEnvLike]>() }
      ]
    };

    patchRRuleTimezoneExpansion(plugin, 'America/Sao_Paulo');

    const errd: RRuleExpandData = {
      rruleSet: {
        tzid: () => 'E. South America Standard Time',
        _dtstart: new Date(Date.UTC(2026, 3, 16, 14, 30, 0)),
        between: () => [new Date(Date.UTC(2026, 3, 16, 14, 30, 0))]
      } as TestRRuleSet
    };

    const expanded = plugin.recurringTypes[0].expand(
      errd,
      { start: new Date('2026-04-01T00:00:00Z'), end: new Date('2026-04-30T00:00:00Z') },
      createDateEnv()
    );

    expect(expanded).toHaveLength(1);
    expect(expanded[0].toISOString()).toBe('2026-04-16T14:30:00.000Z');
  });

  it('correctly performs cross-timezone expansion (Sao Paulo event viewed in UTC, London, New York, Tokyo)', () => {
    const createPlugin = (): RRulePluginLike => ({
      recurringTypes: [
        { expand: jest.fn<Date[], [RRuleExpandData, RRuleFrameRange, RRuleDateEnvLike]>() }
      ]
    });

    const createErrd = (): RRuleExpandData => ({
      rruleSet: {
        tzid: () => 'America/Sao_Paulo',
        _dtstart: new Date(Date.UTC(2026, 3, 16, 14, 30, 0)), // 14:30 in UTC-3 -> 17:30 UTC
        between: () => [new Date(Date.UTC(2026, 3, 16, 14, 30, 0))]
      } as TestRRuleSet
    });

    const frame = {
      start: new Date('2026-04-01T00:00:00Z'),
      end: new Date('2026-04-30T00:00:00Z')
    };

    // View in UTC -> 17:30
    resetRRulePatchStateForTests();
    const p1 = createPlugin();
    patchRRuleTimezoneExpansion(p1, 'UTC');
    const expUtc = p1.recurringTypes[0].expand(createErrd(), frame, createDateEnv());
    expect(expUtc[0].toISOString()).toBe('2026-04-16T17:30:00.000Z');
    expect(expUtc[0].getUTCHours()).toBe(17);
    expect(expUtc[0].getUTCMinutes()).toBe(30);

    // View in London (BST, UTC+1 on April 16) -> 18:30
    resetRRulePatchStateForTests();
    const p2 = createPlugin();
    patchRRuleTimezoneExpansion(p2, 'Europe/London');
    const expLondon = p2.recurringTypes[0].expand(createErrd(), frame, createDateEnv());
    expect(expLondon[0].toISOString()).toBe('2026-04-16T18:30:00.000Z');
    expect(expLondon[0].getUTCHours()).toBe(18);

    // View in New York (EDT, UTC-4 on April 16) -> 13:30
    resetRRulePatchStateForTests();
    const p3 = createPlugin();
    patchRRuleTimezoneExpansion(p3, 'America/New_York');
    const expNy = p3.recurringTypes[0].expand(createErrd(), frame, createDateEnv());
    expect(expNy[0].toISOString()).toBe('2026-04-16T13:30:00.000Z');
    expect(expNy[0].getUTCHours()).toBe(13);

    // View in Tokyo (JST, UTC+9 on April 17) -> 02:30 next day
    resetRRulePatchStateForTests();
    const p4 = createPlugin();
    patchRRuleTimezoneExpansion(p4, 'Asia/Tokyo');
    const expTokyo = p4.recurringTypes[0].expand(createErrd(), frame, createDateEnv());
    expect(expTokyo[0].toISOString()).toBe('2026-04-17T02:30:00.000Z');
    expect(expTokyo[0].getUTCDate()).toBe(17);
    expect(expTokyo[0].getUTCHours()).toBe(2);
  });

  it('preserves DST shifts across seasons for recurring series', () => {
    const plugin: RRulePluginLike = {
      recurringTypes: [
        { expand: jest.fn<Date[], [RRuleExpandData, RRuleFrameRange, RRuleDateEnvLike]>() }
      ]
    };

    // View in Europe/London: 10:00 event in Europe/London
    // Winter (GMT): 2026-01-15 10:00 GMT -> 10:00
    // Summer (BST): 2026-07-15 10:00 BST -> 10:00
    patchRRuleTimezoneExpansion(plugin, 'Europe/London');

    const errd: RRuleExpandData = {
      rruleSet: {
        tzid: () => 'Europe/London',
        _dtstart: new Date(Date.UTC(2026, 0, 15, 10, 0, 0)),
        between: () => [
          new Date(Date.UTC(2026, 0, 15, 10, 0, 0)),
          new Date(Date.UTC(2026, 6, 15, 10, 0, 0))
        ]
      } as TestRRuleSet
    };

    const expanded = plugin.recurringTypes[0].expand(
      errd,
      { start: new Date('2026-01-01T00:00:00Z'), end: new Date('2026-12-31T00:00:00Z') },
      createDateEnv()
    );

    expect(expanded).toHaveLength(2);
    expect(expanded[0].toISOString()).toBe('2026-01-15T10:00:00.000Z');
    expect(expanded[1].toISOString()).toBe('2026-07-15T10:00:00.000Z');
  });

  it('falls back to original expand when tzid is missing', () => {
    const originalExpand = jest.fn<Date[], [RRuleExpandData, RRuleFrameRange, RRuleDateEnvLike]>(
      () => [new Date('2026-03-07T02:00:00.000Z')]
    );

    const plugin: RRulePluginLike = {
      recurringTypes: [{ expand: originalExpand }]
    };

    patchRRuleTimezoneExpansion(plugin, 'Asia/Shanghai');

    const errd: RRuleExpandData = {
      rruleSet: {
        tzid: () => null
      }
    };

    const frameRange: RRuleFrameRange = {
      start: new Date('2026-03-01T00:00:00.000Z'),
      end: new Date('2026-03-31T00:00:00.000Z')
    };

    const expanded = plugin.recurringTypes[0].expand(errd, frameRange, createDateEnv());

    expect(originalExpand).toHaveBeenCalledTimes(1);
    expect(expanded[0].toISOString()).toBe('2026-03-07T02:00:00.000Z');
  });

  describe('real rrule.js integration regressions', () => {
    const createPlugin = (): RRulePluginLike => ({
      recurringTypes: [
        { expand: jest.fn<Date[], [RRuleExpandData, RRuleFrameRange, RRuleDateEnvLike]>() }
      ]
    });

    it('does NOT shift day for evening events across midnight (America/New_York 20:00)', () => {
      const plugin = createPlugin();
      patchRRuleTimezoneExpansion(plugin, 'America/New_York');

      const s = 'DTSTART;TZID=America/New_York:20260601T200000\nRRULE:FREQ=DAILY;COUNT=3';
      const rset = rrulestr(s, { forceset: true });

      const errd: RRuleExpandData = { rruleSet: rset as unknown as RRuleSetLike };
      const frame: RRuleFrameRange = {
        start: new Date('2026-06-01T00:00:00Z'),
        end: new Date('2026-06-30T00:00:00Z')
      };

      const expanded = plugin.recurringTypes[0].expand(errd, frame, createDateEnv());

      expect(expanded).toHaveLength(3);
      // Crucial: Must start on June 1 at 20:00, NOT June 2!
      expect(expanded[0].toISOString()).toBe('2026-06-01T20:00:00.000Z');
      expect(expanded[0].getUTCDate()).toBe(1);
      expect(expanded[0].getUTCHours()).toBe(20);

      expect(expanded[1].toISOString()).toBe('2026-06-02T20:00:00.000Z');
      expect(expanded[1].getUTCDate()).toBe(2);

      expect(expanded[2].toISOString()).toBe('2026-06-03T20:00:00.000Z');
      expect(expanded[2].getUTCDate()).toBe(3);
    });

    it('does NOT shift day backwards for early morning events (Europe/Berlin 02:00)', () => {
      const plugin = createPlugin();
      patchRRuleTimezoneExpansion(plugin, 'Europe/Berlin');

      const s = 'DTSTART;TZID=Europe/Berlin:20260601T020000\nRRULE:FREQ=DAILY;COUNT=3';
      const rset = rrulestr(s, { forceset: true });

      const errd: RRuleExpandData = { rruleSet: rset as unknown as RRuleSetLike };
      const frame: RRuleFrameRange = {
        start: new Date('2026-06-01T00:00:00Z'),
        end: new Date('2026-06-30T00:00:00Z')
      };

      const expanded = plugin.recurringTypes[0].expand(errd, frame, createDateEnv());

      expect(expanded).toHaveLength(3);
      expect(expanded[0].toISOString()).toBe('2026-06-01T02:00:00.000Z');
      expect(expanded[0].getUTCDate()).toBe(1);
      expect(expanded[0].getUTCHours()).toBe(2);

      expect(expanded[1].toISOString()).toBe('2026-06-02T02:00:00.000Z');
      expect(expanded[2].toISOString()).toBe('2026-06-03T02:00:00.000Z');
    });

    it('preserves multiple hours in recurrence rules (BYHOUR=9,17)', () => {
      const plugin = createPlugin();
      patchRRuleTimezoneExpansion(plugin, 'Europe/London');

      const s = 'DTSTART;TZID=Europe/London:20260601T090000\nRRULE:FREQ=DAILY;BYHOUR=9,17;COUNT=4';
      const rset = rrulestr(s, { forceset: true });

      const errd: RRuleExpandData = { rruleSet: rset as unknown as RRuleSetLike };
      const frame: RRuleFrameRange = {
        start: new Date('2026-06-01T00:00:00Z'),
        end: new Date('2026-06-30T00:00:00Z')
      };

      const expanded = plugin.recurringTypes[0].expand(errd, frame, createDateEnv());

      expect(expanded).toHaveLength(4);
      expect(expanded[0].toISOString()).toBe('2026-06-01T09:00:00.000Z');
      expect(expanded[1].toISOString()).toBe('2026-06-01T17:00:00.000Z');
      expect(expanded[2].toISOString()).toBe('2026-06-02T09:00:00.000Z');
      expect(expanded[3].toISOString()).toBe('2026-06-02T17:00:00.000Z');
    });

    it('preserves multiple minutes in recurrence rules (BYMINUTE=15,45)', () => {
      const plugin = createPlugin();
      patchRRuleTimezoneExpansion(plugin, 'Europe/London');

      const s =
        'DTSTART;TZID=Europe/London:20260601T091500\nRRULE:FREQ=HOURLY;BYMINUTE=15,45;COUNT=4';
      const rset = rrulestr(s, { forceset: true });

      const errd: RRuleExpandData = { rruleSet: rset as unknown as RRuleSetLike };
      const frame: RRuleFrameRange = {
        start: new Date('2026-06-01T00:00:00Z'),
        end: new Date('2026-06-30T00:00:00Z')
      };

      const expanded = plugin.recurringTypes[0].expand(errd, frame, createDateEnv());

      expect(expanded).toHaveLength(4);
      expect(expanded[0].toISOString()).toBe('2026-06-01T09:15:00.000Z');
      expect(expanded[1].toISOString()).toBe('2026-06-01T09:45:00.000Z');
      expect(expanded[2].toISOString()).toBe('2026-06-01T10:15:00.000Z');
      expect(expanded[3].toISOString()).toBe('2026-06-01T10:45:00.000Z');
    });

    it('correctly handles positive UTC offsets with UNTIL without dropping the final day (Pacific/Auckland)', () => {
      const plugin = createPlugin();
      patchRRuleTimezoneExpansion(plugin, 'Pacific/Auckland');

      const s =
        'DTSTART;TZID=Pacific/Auckland:20260416T143000\nRRULE:FREQ=DAILY;UNTIL=20260418T115959Z';
      const rset = rrulestr(s, { forceset: true });

      const errd: RRuleExpandData = { rruleSet: rset as unknown as RRuleSetLike };
      const frame: RRuleFrameRange = {
        start: new Date('2026-04-01T00:00:00Z'),
        end: new Date('2026-04-30T00:00:00Z')
      };

      const expanded = plugin.recurringTypes[0].expand(errd, frame, createDateEnv());

      expect(expanded).toHaveLength(3);
      expect(expanded[0].toISOString()).toBe('2026-04-16T14:30:00.000Z');
      expect(expanded[1].toISOString()).toBe('2026-04-17T14:30:00.000Z');
      expect(expanded[2].toISOString()).toBe('2026-04-18T14:30:00.000Z');
    });

    it('correctly excludes EXDATE dates in real rrule', () => {
      const plugin = createPlugin();
      patchRRuleTimezoneExpansion(plugin, 'America/New_York');

      const s = [
        'DTSTART;TZID=America/New_York:20260601T200000',
        'RRULE:FREQ=DAILY;COUNT=5',
        'EXDATE;TZID=America/New_York:20260603T200000'
      ].join('\n');
      const rset = rrulestr(s, { forceset: true });

      const errd: RRuleExpandData = { rruleSet: rset as unknown as RRuleSetLike };
      const frame: RRuleFrameRange = {
        start: new Date('2026-06-01T00:00:00Z'),
        end: new Date('2026-06-30T00:00:00Z')
      };

      const expanded = plugin.recurringTypes[0].expand(errd, frame, createDateEnv());

      expect(expanded).toHaveLength(4);
      expect(expanded.map(d => d.getUTCDate())).toEqual([1, 2, 4, 5]);
    });

    it('handles DST Spring-Forward boundary accurately in both source and target timezones', () => {
      // US Spring forward: March 8, 2026 at 02:00 -> 03:00
      const s = 'DTSTART;TZID=America/New_York:20260307T100000\nRRULE:FREQ=DAILY;COUNT=3';

      // Viewed in America/New_York: wall-clock remains 10:00 AM every day
      const pluginNy = createPlugin();
      patchRRuleTimezoneExpansion(pluginNy, 'America/New_York');
      const rsetNy = rrulestr(s, { forceset: true });
      const expNy = pluginNy.recurringTypes[0].expand(
        { rruleSet: rsetNy as unknown as RRuleSetLike },
        { start: new Date('2026-03-01T00:00:00Z'), end: new Date('2026-03-31T00:00:00Z') },
        createDateEnv()
      );
      expect(expNy).toHaveLength(3);
      expect(expNy[0].toISOString()).toBe('2026-03-07T10:00:00.000Z');
      expect(expNy[1].toISOString()).toBe('2026-03-08T10:00:00.000Z');
      expect(expNy[2].toISOString()).toBe('2026-03-09T10:00:00.000Z');

      // Viewed in UTC: 10:00 EST (UTC-5) is 15:00 UTC, 10:00 EDT (UTC-4) is 14:00 UTC
      resetRRulePatchStateForTests();
      const pluginUtc = createPlugin();
      patchRRuleTimezoneExpansion(pluginUtc, 'UTC');
      const rsetUtc = rrulestr(s, { forceset: true });
      const expUtc = pluginUtc.recurringTypes[0].expand(
        { rruleSet: rsetUtc as unknown as RRuleSetLike },
        { start: new Date('2026-03-01T00:00:00Z'), end: new Date('2026-03-31T00:00:00Z') },
        createDateEnv()
      );
      expect(expUtc).toHaveLength(3);
      expect(expUtc[0].toISOString()).toBe('2026-03-07T15:00:00.000Z');
      expect(expUtc[1].toISOString()).toBe('2026-03-08T14:00:00.000Z');
      expect(expUtc[2].toISOString()).toBe('2026-03-09T14:00:00.000Z');
    });

    it('handles DST Fall-Back boundary accurately in both source and target timezones', () => {
      // US Fall back: Nov 1, 2026 at 02:00 -> 01:00
      const s = 'DTSTART;TZID=America/New_York:20261031T100000\nRRULE:FREQ=DAILY;COUNT=3';

      // Viewed in America/New_York: wall-clock remains 10:00 AM every day
      const pluginNy = createPlugin();
      patchRRuleTimezoneExpansion(pluginNy, 'America/New_York');
      const rsetNy = rrulestr(s, { forceset: true });
      const expNy = pluginNy.recurringTypes[0].expand(
        { rruleSet: rsetNy as unknown as RRuleSetLike },
        { start: new Date('2026-10-01T00:00:00Z'), end: new Date('2026-11-30T00:00:00Z') },
        createDateEnv()
      );
      expect(expNy).toHaveLength(3);
      expect(expNy[0].toISOString()).toBe('2026-10-31T10:00:00.000Z');
      expect(expNy[1].toISOString()).toBe('2026-11-01T10:00:00.000Z');
      expect(expNy[2].toISOString()).toBe('2026-11-02T10:00:00.000Z');

      // Viewed in UTC: 10:00 EDT (UTC-4) is 14:00 UTC, 10:00 EST (UTC-5) is 15:00 UTC
      resetRRulePatchStateForTests();
      const pluginUtc = createPlugin();
      patchRRuleTimezoneExpansion(pluginUtc, 'UTC');
      const rsetUtc = rrulestr(s, { forceset: true });
      const expUtc = pluginUtc.recurringTypes[0].expand(
        { rruleSet: rsetUtc as unknown as RRuleSetLike },
        { start: new Date('2026-10-01T00:00:00Z'), end: new Date('2026-11-30T00:00:00Z') },
        createDateEnv()
      );
      expect(expUtc).toHaveLength(3);
      expect(expUtc[0].toISOString()).toBe('2026-10-31T14:00:00.000Z');
      expect(expUtc[1].toISOString()).toBe('2026-11-01T15:00:00.000Z');
      expect(expUtc[2].toISOString()).toBe('2026-11-02T15:00:00.000Z');
    });

    it('prioritizes active calendar dateEnv.timeZone over closure settingsTimeZone (multi-calendar support)', () => {
      const plugin = createPlugin();
      // Calendar initialized with Europe/London
      patchRRuleTimezoneExpansion(plugin, 'Europe/London');

      const s = 'DTSTART;TZID=UTC:20260601T100000\nRRULE:FREQ=DAILY;COUNT=1';
      const rset = rrulestr(s, { forceset: true });

      // But DateEnv belongs to another calendar instance configured with America/New_York (UTC-4)
      const dateEnvWithNy: RRuleDateEnvLike = {
        toDate: d => new Date(d),
        createMarker: d => new Date(d),
        timeZone: 'America/New_York'
      } as RRuleDateEnvLike & { timeZone: string };

      const exp = plugin.recurringTypes[0].expand(
        { rruleSet: rset as unknown as RRuleSetLike },
        { start: new Date('2026-06-01T00:00:00Z'), end: new Date('2026-06-02T00:00:00Z') },
        dateEnvWithNy
      );

      expect(exp).toHaveLength(1);
      // In New York (EDT, UTC-4), 10:00 UTC is 06:00 EDT (NOT 11:00 BST in London)
      expect(exp[0].toISOString()).toBe('2026-06-01T06:00:00.000Z');
      expect(exp[0].getUTCHours()).toBe(6);
    });

    it('clears rruleObj._cache to prevent stale cached dates from being returned', () => {
      const plugin = createPlugin();
      patchRRuleTimezoneExpansion(plugin, 'America/New_York');

      const s = 'DTSTART;TZID=America/New_York:20260601T100000\nRRULE:FREQ=DAILY;COUNT=1';
      const rset = rrulestr(s, { forceset: true }) as unknown as {
        _cache?: { between?: unknown[]; all?: unknown };
      };

      // Artificially populate a stale cache
      rset._cache = {
        between: [
          {
            after: new Date('2026-05-30T00:00:00Z'),
            before: new Date('2026-06-03T00:00:00Z'),
            inc: false,
            _value: [new Date('1999-01-01T00:00:00Z')]
          }
        ]
      };

      const exp = plugin.recurringTypes[0].expand(
        { rruleSet: rset as unknown as RRuleSetLike },
        { start: new Date('2026-06-01T00:00:00Z'), end: new Date('2026-06-02T00:00:00Z') },
        createDateEnv()
      );

      expect(exp).toHaveLength(1);
      expect(exp[0].toISOString()).toBe('2026-06-01T10:00:00.000Z');
    });
  });
});

describe('resolveSourceZone', () => {
  it('returns valid IANA timezones as-is', () => {
    expect(resolveSourceZone('America/Sao_Paulo')).toBe('America/Sao_Paulo');
    expect(resolveSourceZone('Europe/London')).toBe('Europe/London');
    expect(resolveSourceZone('Asia/Tokyo')).toBe('Asia/Tokyo');
  });

  it('strips double and single quotes from timezone strings', () => {
    expect(resolveSourceZone('"America/Sao_Paulo"')).toBe('America/Sao_Paulo');
    expect(resolveSourceZone("'Europe/Paris'")).toBe('Europe/Paris');
  });

  it('strips quotes even when surrounded by whitespace', () => {
    expect(resolveSourceZone('  "America/Sao_Paulo"  ')).toBe('America/Sao_Paulo');
    expect(resolveSourceZone("  'Europe/Paris'  ")).toBe('Europe/Paris');
  });

  it('strips multiple enclosing quotes', () => {
    expect(resolveSourceZone('""America/Sao_Paulo""')).toBe('America/Sao_Paulo');
    expect(resolveSourceZone("''Europe/Paris''")).toBe('Europe/Paris');
  });

  it('normalizes UTC representations to RFC 5545 uppercase UTC', () => {
    expect(resolveSourceZone('UTC')).toBe('UTC');
    expect(resolveSourceZone('utc')).toBe('UTC');
    expect(resolveSourceZone('Z')).toBe('UTC');
    expect(resolveSourceZone('"UTC"')).toBe('UTC');
    expect(resolveSourceZone('  "UTC"  ')).toBe('UTC');
  });

  it('normalizes Windows timezone identifiers to IANA', () => {
    expect(resolveSourceZone('E. South America Standard Time')).toBe('America/Sao_Paulo');
    expect(resolveSourceZone('SA Eastern Standard Time')).toBe('America/Sao_Paulo');
    expect(resolveSourceZone('Argentina Standard Time')).toBe('America/Buenos_Aires');
    expect(resolveSourceZone('GMT Standard Time')).toBe('Europe/London');
    expect(resolveSourceZone('Eastern Standard Time')).toBe('America/New_York');
    expect(resolveSourceZone('Romance Standard Time')).toBe('Europe/Paris');
    expect(resolveSourceZone('FLE Standard Time')).toBe('Europe/Kyiv');
    expect(resolveSourceZone('SE Asia Standard Time')).toBe('Asia/Bangkok');
    expect(resolveSourceZone('US Eastern Standard Time')).toBe('America/Indianapolis');
    expect(resolveSourceZone('Canada Central Standard Time')).toBe('America/Regina');
    expect(resolveSourceZone('Cen. Australia Standard Time')).toBe('Australia/Adelaide');
    expect(resolveSourceZone('W. Central Africa Standard Time')).toBe('Africa/Lagos');
  });

  it('falls back to fallbackZone when event timezone is missing, empty, or whitespace', () => {
    expect(resolveSourceZone(null, 'America/Chicago')).toBe('America/Chicago');
    expect(resolveSourceZone(undefined, 'Europe/Berlin')).toBe('Europe/Berlin');
    expect(resolveSourceZone('', 'Asia/Tokyo')).toBe('Asia/Tokyo');
    expect(resolveSourceZone('   ', 'America/Chicago')).toBe('America/Chicago');
    expect(resolveSourceZone('""', 'Europe/Berlin')).toBe('Europe/Berlin');
    expect(resolveSourceZone("''", 'Asia/Tokyo')).toBe('Asia/Tokyo');
    expect(resolveSourceZone(' " " ', 'America/Sao_Paulo')).toBe('America/Sao_Paulo');
  });

  it('falls back to fallbackZone when event timezone is floating', () => {
    expect(resolveSourceZone('floating', 'America/New_York')).toBe('America/New_York');
    expect(resolveSourceZone('FLOATING', 'Europe/London')).toBe('Europe/London');
    expect(resolveSourceZone('floating', null)).toBe('UTC');
  });

  it('falls back to fallbackZone when event timezone is an invalid or unrecognized identifier', () => {
    expect(resolveSourceZone('Invalid/NonExistent_Zone', 'Europe/Paris')).toBe('Europe/Paris');
    expect(resolveSourceZone('bogus_zone_123', 'America/Chicago')).toBe('America/Chicago');
  });

  it('falls back to UTC when both event timezone and fallbackZone are missing or empty', () => {
    expect(resolveSourceZone(null, null)).toBe('UTC');
    expect(resolveSourceZone(undefined, undefined)).toBe('UTC');
    expect(resolveSourceZone('', '')).toBe('UTC');
    expect(resolveSourceZone('   ', '   ')).toBe('UTC');
  });
});

describe('resolveEffectiveTimezone', () => {
  it('returns valid IANA timezone as-is', () => {
    expect(resolveEffectiveTimezone('Europe/Bucharest')).toBe('Europe/Bucharest');
    expect(resolveEffectiveTimezone('America/New_York')).toBe('America/New_York');
  });

  it('maps Windows timezones to IANA', () => {
    expect(resolveEffectiveTimezone('E. Europe Standard Time')).toBe('Europe/Bucharest');
    expect(resolveEffectiveTimezone('Pacific Standard Time')).toBe('America/Los_Angeles');
  });

  it('strips quotes and whitespace from effective timezone', () => {
    expect(resolveEffectiveTimezone('"Europe/Berlin"')).toBe('Europe/Berlin');
    expect(resolveEffectiveTimezone('  "America/Chicago"  ')).toBe('America/Chicago');
  });

  it('falls back to system/display timezone when event timezone is floating or invalid', () => {
    const fallback = resolveEffectiveTimezone();
    expect(resolveEffectiveTimezone('floating')).toBe(fallback);
    expect(resolveEffectiveTimezone('Invalid/BogusZone')).toBe(fallback);
  });
});

describe('parseTimezoneAwareString', () => {
  it('handles date-only (all day) times as UTC dates', () => {
    const time = new ical.Time({ year: 2026, month: 5, day: 20, isDate: true });
    const dt = parseTimezoneAwareString(time);
    expect(dt.isValid).toBe(true);
    expect(dt.zoneName).toBe('UTC');
    expect(dt.toISODate()).toBe('2026-05-20');
  });

  it('maps Windows timezone to IANA zone', () => {
    const time = new ical.Time({
      year: 2026,
      month: 10,
      day: 15,
      hour: 14,
      minute: 0
    });
    time.timezone = 'E. South America Standard Time';
    const dt = parseTimezoneAwareString(time);
    expect(dt.isValid).toBe(true);
    expect(dt.zoneName).toBe('America/Sao_Paulo');
    expect(dt.toFormat('HH:mm')).toBe('14:00');
  });

  it('falls back to VTIMEZONE offset and warns when timezone is unmapped', () => {
    const warnSpy = jest.spyOn(console, 'warn').mockImplementation(() => {});

    const mockTime = {
      isDate: false,
      year: 2026,
      month: 10,
      day: 15,
      hour: 14,
      minute: 0,
      second: 0,
      timezone: undefined,
      zone: { tzid: 'Custom Corp Standard Time' },
      utcOffset: () => -14400 // -04:00
    } as unknown as ical.Time;

    const dt = parseTimezoneAwareString(mockTime);
    expect(dt.isValid).toBe(true);
    expect(dt.zoneName).toBe('UTC-4');
    expect(dt.toFormat('HH:mm')).toBe('14:00');
    expect(warnSpy).toHaveBeenCalledWith(
      expect.stringContaining(
        'Unrecognized timezone identifier "Custom Corp Standard Time". Falling back to VTIMEZONE offset (UTC-4).'
      )
    );

    warnSpy.mockRestore();
  });

  it('falls back to UTC and warns when timezone is unmapped and has no valid offset', () => {
    const warnSpy = jest.spyOn(console, 'warn').mockImplementation(() => {});

    const mockTime = {
      isDate: false,
      year: 2026,
      month: 10,
      day: 15,
      hour: 14,
      minute: 0,
      second: 0,
      timezone: 'Totally Unknown Nonexistent Timezone',
      zone: undefined,
      utcOffset: undefined
    } as unknown as ical.Time;

    const dt = parseTimezoneAwareString(mockTime);
    expect(dt.isValid).toBe(true);
    expect(dt.zoneName).toBe('UTC');
    expect(dt.toFormat('HH:mm')).toBe('14:00');
    expect(warnSpy).toHaveBeenCalledWith(
      expect.stringContaining(
        'Unrecognized timezone identifier "Totally Unknown Nonexistent Timezone" with no valid offset. Falling back to UTC.'
      )
    );

    warnSpy.mockRestore();
  });
});
