import { resolveCalendarRenderConfig } from './CalendarViewConfigResolver';
import { DEFAULT_SETTINGS, FullCalendarSettings } from '../../types/settings';

describe('CalendarViewConfigResolver', () => {
  const baseSettings: FullCalendarSettings = {
    ...DEFAULT_SETTINGS,
    displayTimezone: 'UTC'
  };

  test('resolves defaultDate from workspace calendarConfig', () => {
    const calendarConfig = {
      defaultDate: '1944-06-06'
    };

    const resolved = resolveCalendarRenderConfig(calendarConfig, baseSettings);
    expect(resolved.defaultDate).toBe('1944-06-06');
  });

  test('allows overrides to take precedence over calendarConfig for defaultDate', () => {
    const calendarConfig = {
      defaultDate: '1944-06-06'
    };

    const resolved = resolveCalendarRenderConfig(calendarConfig, baseSettings, {
      defaultDate: '2024-01-01'
    });
    expect(resolved.defaultDate).toBe('2024-01-01');
  });

  test('resolves undefined defaultDate when neither config nor override specifies it', () => {
    const resolved = resolveCalendarRenderConfig({}, baseSettings);
    expect(resolved.defaultDate).toBeUndefined();
  });
});
