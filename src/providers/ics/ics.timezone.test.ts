import { DateTime } from 'luxon';

import { toEventInput } from '../../core/interop';
import { DEFAULT_SETTINGS, FullCalendarSettings } from '../../types/settings';
import { getEventsFromICS } from './ics';

jest.mock('../../ui/view', () => ({
  getCalendarColors: (color: string) => ({ color, textColor: '#ffffff' })
}));

const settings: FullCalendarSettings = {
  ...DEFAULT_SETTINGS,
  displayTimezone: 'Asia/Nicosia'
};

describe('Outlook ICS Windows timezone rendering', () => {
  it.each([
    ['summer', '20260729', '+03:00'],
    ['winter', '20260129', '+02:00']
  ])(
    'keeps a GTB Standard Time event at 10:00 in Asia/Nicosia in %s',
    (_season, icsDate, expectedOffset) => {
      const events = getEventsFromICS(`BEGIN:VCALENDAR
VERSION:2.0
PRODID:-//Synthetic Outlook ICS Test//EN
BEGIN:VEVENT
UID:synthetic-gtb-${icsDate}
DTSTART;TZID=GTB Standard Time:${icsDate}T100000
DTEND;TZID=GTB Standard Time:${icsDate}T103000
SUMMARY:Synthetic timezone test
END:VEVENT
END:VCALENDAR`);

      expect(events).toHaveLength(1);
      const event = events[0];

      // EventDetails formats these cached wall-clock fields directly.
      expect(event).toMatchObject({
        type: 'single',
        allDay: false,
        startTime: '10:00',
        endTime: '10:30',
        timezone: 'Europe/Bucharest'
      });

      const eventInput = toEventInput(`synthetic-gtb-${icsDate}`, event, settings);
      expect(eventInput).not.toBeNull();

      const sourceStart = DateTime.fromISO(String(eventInput?.start), { setZone: true });
      const sourceEnd = DateTime.fromISO(String(eventInput?.end), { setZone: true });
      expect(sourceStart.toFormat('ZZ')).toBe(expectedOffset);
      expect(sourceEnd.toFormat('ZZ')).toBe(expectedOffset);

      // FullCalendar is configured with Asia/Nicosia and renders these instants there.
      const renderedStart = sourceStart.setZone(settings.displayTimezone!);
      const renderedEnd = sourceEnd.setZone(settings.displayTimezone!);
      expect(renderedStart.toFormat('HH:mm')).toBe('10:00');
      expect(renderedEnd.toFormat('HH:mm')).toBe('10:30');
      expect(renderedStart.toFormat('HH:mm')).not.toBe(_season === 'summer' ? '13:00' : '12:00');
      expect(renderedEnd.toFormat('HH:mm')).not.toBe(_season === 'summer' ? '13:30' : '12:30');
    }
  );

  it('correctly maps Outlook Exchange E. South America Standard Time with VTIMEZONE', () => {
    const saoPauloSettings: FullCalendarSettings = {
      ...DEFAULT_SETTINGS,
      displayTimezone: 'America/Sao_Paulo'
    };

    const icsContent = `BEGIN:VCALENDAR
VERSION:2.0
PRODID:Microsoft Exchange Server 2010
BEGIN:VTIMEZONE
TZID:E. South America Standard Time
BEGIN:STANDARD
DTSTART:16010101T000000
TZOFFSETFROM:-0300
TZOFFSETTO:-0300
END:STANDARD
END:VTIMEZONE
BEGIN:VEVENT
UID:outlook-exchange-saopaulo-1
DTSTART;TZID=E. South America Standard Time:20261015T140000
DTEND;TZID=E. South America Standard Time:20261015T150000
SUMMARY:Exchange Team Meeting
END:VEVENT
END:VCALENDAR`;

    const events = getEventsFromICS(icsContent);
    expect(events).toHaveLength(1);
    const event = events[0];

    expect(event).toMatchObject({
      type: 'single',
      allDay: false,
      startTime: '14:00',
      endTime: '15:00',
      timezone: 'America/Sao_Paulo'
    });

    const eventInput = toEventInput('outlook-exchange-saopaulo-1', event, saoPauloSettings);
    expect(eventInput).not.toBeNull();

    const startDt = DateTime.fromISO(String(eventInput?.start), { setZone: true });
    expect(startDt.toFormat('HH:mm')).toBe('14:00');
    expect(startDt.setZone('America/Sao_Paulo').toFormat('HH:mm')).toBe('14:00');
  });

  it('falls back to VTIMEZONE offset and logs warning when timezone is not in the dictionary', () => {
    const warnSpy = jest.spyOn(console, 'warn').mockImplementation(() => {});

    const icsContent = `BEGIN:VCALENDAR
VERSION:2.0
PRODID:Custom Enterprise Server 1.0
BEGIN:VTIMEZONE
TZID:Acme Corp Custom Standard Time
BEGIN:STANDARD
DTSTART:16010101T000000
TZOFFSETFROM:-0400
TZOFFSETTO:-0400
END:STANDARD
END:VTIMEZONE
BEGIN:VEVENT
UID:custom-tz-event-1
DTSTART;TZID=Acme Corp Custom Standard Time:20261015T140000
DTEND;TZID=Acme Corp Custom Standard Time:20261015T150000
SUMMARY:Custom Timezone Meeting
END:VEVENT
END:VCALENDAR`;

    const events = getEventsFromICS(icsContent);
    expect(events).toHaveLength(1);
    const event = events[0];

    expect(event).toMatchObject({
      type: 'single',
      allDay: false,
      startTime: '14:00',
      endTime: '15:00',
      timezone: 'UTC-4'
    });

    expect(warnSpy).toHaveBeenCalledWith(
      expect.stringContaining(
        'Unrecognized timezone identifier "Acme Corp Custom Standard Time". Falling back to VTIMEZONE offset'
      )
    );

    const eventInput = toEventInput('custom-tz-event-1', event, settings);
    expect(eventInput).not.toBeNull();

    const startDt = DateTime.fromISO(String(eventInput?.start), { setZone: true });
    expect(startDt.offset).toBe(-240); // -04:00 = -240 minutes

    warnSpy.mockRestore();
  });
});
