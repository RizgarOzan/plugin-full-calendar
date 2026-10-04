import { showNotice } from '../../../utils/showNotice';
import * as React from 'react';
import { useState } from 'react';
import { UrlInput } from '../../../ui/components/forms/UrlInput';
import { UsernameInput } from '../../../ui/components/forms/UsernameInput';
import { PasswordInput } from '../../../ui/components/forms/PasswordInput';
import { CalDAVProviderConfig } from '../types/typesCalDAV';
import {
  importCalendars,
  discoverCalDAVAccount,
  DiscoveredCalDAVCollection
} from '../client/import_caldav';
import { t } from '../../../features/i18n/i18n';
import { CredentialStore } from '../../../features/credentials/CredentialStore';

interface CalDAVConfigComponentProps {
  config: Partial<CalDAVProviderConfig>;
  onSave: (configs: CalDAVProviderConfig[]) => void;
  onClose: () => void;
  mode?: 'events' | 'tasks';
}

export const CalDAVConfigComponent: React.FC<CalDAVConfigComponentProps> = ({
  config,
  onSave,
  onClose,
  mode = 'events'
}) => {
  const [view, setView] = useState<'credentials' | 'select'>('credentials');
  const [url, setUrl] = useState(config.url || config.homeUrl || '');
  const [username, setUsername] = useState(config.username || '');
  const [password, setPassword] = useState(() => {
    if (config.id) {
      return CredentialStore.getCalDAVPassword(config.id) || config.password || '';
    }
    return config.password || '';
  });
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [isManualMode, setIsManualMode] = useState(Boolean(config.id));
  const [discoveredCollections, setDiscoveredCollections] = useState<DiscoveredCalDAVCollection[]>(
    []
  );
  const [selectedUrls, setSelectedUrls] = useState<Set<string>>(new Set());

  // Handle standard multi-collection discovery
  const handleDiscover = async (e?: React.SyntheticEvent) => {
    if (e) e.preventDefault();
    if (!url || !username || !password) return;

    setIsSubmitting(true);
    try {
      const collections = await discoverCalDAVAccount({
        url,
        username,
        password
      });

      if (collections.length === 0) {
        showNotice(t('settings.calendars.caldav.noCollectionsFound'));
        setIsSubmitting(false);
        return;
      }

      setDiscoveredCollections(collections);

      // Pre-select collections according to current modal mode
      const initialSelected = new Set<string>();
      for (const col of collections) {
        if (mode === 'tasks') {
          if (col.type === 'caldavtasks' || col.type === 'both') {
            initialSelected.add(col.href);
          }
        } else {
          if (col.type === 'caldav' || col.type === 'both') {
            initialSelected.add(col.href);
          }
        }
      }

      // If pre-selection was empty, select all
      if (initialSelected.size === 0) {
        collections.forEach(c => initialSelected.add(c.href));
      }

      setSelectedUrls(initialSelected);
      setView('select');
    } catch (error) {
      console.error('[CalDAV] Discovery error', error);
      const details = error instanceof Error ? error.message : String(error);
      showNotice(`${t('settings.calendars.caldav.importFailed')}: ${details}`);
    } finally {
      setIsSubmitting(false);
    }
  };

  // Handle direct manual collection import (backward compatibility)
  const handleManualImport = async (e?: React.SyntheticEvent) => {
    if (e) e.preventDefault();
    if (!url || !username || !password) return;

    setIsSubmitting(true);
    try {
      const sources =
        mode === 'tasks'
          ? await importCalendars({ type: 'basic', username, password }, url, [], 'caldavtasks')
          : await importCalendars({ type: 'basic', username, password }, url, []);
      onSave(sources);
      onClose();
    } catch (error) {
      const errorKey =
        mode === 'tasks'
          ? 'settings.calendars.caldavTasks.importFailed'
          : 'settings.calendars.caldav.importFailed';
      console.error(t(errorKey), error);
      const details = error instanceof Error ? error.message : String(error);
      showNotice(`${t(errorKey)}: ${details}`);
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleToggleSelect = (href: string) => {
    setSelectedUrls(prev => {
      const next = new Set(prev);
      if (next.has(href)) {
        next.delete(href);
      } else {
        next.add(href);
      }
      return next;
    });
  };

  const handleSelectAll = (select: boolean) => {
    if (select) {
      setSelectedUrls(new Set(discoveredCollections.map(c => c.href)));
    } else {
      setSelectedUrls(new Set());
    }
  };

  const handleSaveDiscovered = () => {
    const selected = discoveredCollections.filter(c => selectedUrls.has(c.href));
    if (selected.length === 0) return;

    const configs: CalDAVProviderConfig[] = selected.map(col => {
      // Determine appropriate provider type:
      // If modal is in 'tasks' mode, prioritize 'caldavtasks' unless it explicitly only supports events
      const targetType: 'caldav' | 'caldavtasks' =
        mode === 'tasks'
          ? col.type === 'caldav'
            ? 'caldav'
            : 'caldavtasks'
          : col.type === 'caldavtasks'
            ? 'caldavtasks'
            : 'caldav';

      return {
        id: '', // Will be assigned by SettingsTab
        name: col.displayName,
        url: col.serverUrl,
        homeUrl: col.href,
        username,
        password,
        type: targetType,
        color: col.color
      };
    });

    onSave(configs);
    onClose();
  };

  if (view === 'select') {
    const eventCalendars = discoveredCollections.filter(c => c.type !== 'caldavtasks');
    const taskCalendars = discoveredCollections.filter(c => c.type !== 'caldav');

    return (
      <div className="caldav-discovery-select">
        <div className="setting-item setting-item-heading">
          <div className="setting-item-info">
            <div className="setting-item-name">{t('settings.calendars.caldav.selectTitle')}</div>
            <div className="setting-item-description">
              {t('settings.calendars.caldav.selectDescription')}
            </div>
          </div>
        </div>

        {eventCalendars.length > 0 && (
          <div className="caldav-section">
            <div className="setting-item setting-item-heading" style={{ borderBottom: 'none' }}>
              <div className="setting-item-info">
                <div className="setting-item-name" style={{ fontSize: '0.95em', fontWeight: 600 }}>
                  {t('settings.calendars.caldav.sectionCalendars')}
                </div>
              </div>
            </div>
            {eventCalendars.map(col => (
              <div
                key={col.href}
                className="setting-item"
                style={{ padding: '6px 0', cursor: 'pointer' }}
                onClick={() => handleToggleSelect(col.href)}
              >
                <div
                  className="setting-item-info"
                  style={{ display: 'flex', alignItems: 'center' }}
                >
                  <span
                    style={{
                      display: 'inline-block',
                      width: '12px',
                      height: '12px',
                      borderRadius: '50%',
                      backgroundColor: col.color || '#888888',
                      marginRight: '10px',
                      flexShrink: 0
                    }}
                  />
                  <div>
                    <div className="setting-item-name">{col.displayName}</div>
                    <div className="setting-item-description" style={{ fontSize: '0.8em' }}>
                      {col.href}
                    </div>
                  </div>
                </div>
                <div className="setting-item-control">
                  <input
                    type="checkbox"
                    checked={selectedUrls.has(col.href)}
                    onChange={() => handleToggleSelect(col.href)}
                    onClick={e => e.stopPropagation()}
                  />
                </div>
              </div>
            ))}
          </div>
        )}

        {taskCalendars.length > 0 && (
          <div className="caldav-section" style={{ marginTop: '12px' }}>
            <div className="setting-item setting-item-heading" style={{ borderBottom: 'none' }}>
              <div className="setting-item-info">
                <div className="setting-item-name" style={{ fontSize: '0.95em', fontWeight: 600 }}>
                  {t('settings.calendars.caldav.sectionTasks')}
                </div>
              </div>
            </div>
            {taskCalendars.map(col => (
              <div
                key={col.href}
                className="setting-item"
                style={{ padding: '6px 0', cursor: 'pointer' }}
                onClick={() => handleToggleSelect(col.href)}
              >
                <div
                  className="setting-item-info"
                  style={{ display: 'flex', alignItems: 'center' }}
                >
                  <span
                    style={{
                      display: 'inline-block',
                      width: '12px',
                      height: '12px',
                      borderRadius: '50%',
                      backgroundColor: col.color || '#888888',
                      marginRight: '10px',
                      flexShrink: 0
                    }}
                  />
                  <div>
                    <div className="setting-item-name">{col.displayName}</div>
                    <div className="setting-item-description" style={{ fontSize: '0.8em' }}>
                      {col.href}
                    </div>
                  </div>
                </div>
                <div className="setting-item-control">
                  <input
                    type="checkbox"
                    checked={selectedUrls.has(col.href)}
                    onChange={() => handleToggleSelect(col.href)}
                    onClick={e => e.stopPropagation()}
                  />
                </div>
              </div>
            ))}
          </div>
        )}

        <div className="setting-item" style={{ marginTop: '16px' }}>
          <div className="setting-item-info">
            <button
              type="button"
              className="mod-ghost"
              onClick={() => handleSelectAll(selectedUrls.size < discoveredCollections.length)}
            >
              {selectedUrls.size < discoveredCollections.length
                ? t('settings.calendars.caldav.selectAll')
                : t('settings.calendars.caldav.deselectAll')}
            </button>
          </div>
          <div className="setting-item-control" style={{ display: 'flex', gap: '8px' }}>
            <button type="button" onClick={() => setView('credentials')}>
              {t('settings.calendars.caldav.backButton')}
            </button>
            <button
              type="button"
              className="mod-cta"
              disabled={selectedUrls.size === 0}
              onClick={handleSaveDiscovered}
            >
              {t('settings.calendars.caldav.importSelected', { count: selectedUrls.size })}
            </button>
          </div>
        </div>
      </div>
    );
  }

  return (
    <form
      onSubmit={e => {
        e.preventDefault();
        if (isManualMode) {
          void handleManualImport(e);
        } else {
          void handleDiscover(e);
        }
      }}
    >
      {mode === 'tasks' && (
        <div className="setting-item">
          <div className="setting-item-info">
            <div className="setting-item-name">{t('settings.calendars.caldavTasks.title')}</div>
            <div className="setting-item-description">
              {t('settings.calendars.caldavTasks.description')}
            </div>
          </div>
        </div>
      )}

      <div className="setting-item">
        <div className="setting-item-info">
          <div className="setting-item-name">
            {isManualMode
              ? t('settings.calendars.caldav.url.label')
              : t('settings.calendars.caldav.serverUrl.label')}
          </div>
          <div className="setting-item-description">
            {isManualMode
              ? t('settings.calendars.caldav.url.description')
              : t('settings.calendars.caldav.serverUrl.description')}
          </div>
        </div>
        <div className="setting-item-control">
          <UrlInput value={url} onChange={setUrl} />
        </div>
      </div>

      <div className="setting-item">
        <div className="setting-item-info">
          <div className="setting-item-name">{t('settings.calendars.caldav.username.label')}</div>
          <div className="setting-item-description">
            {t('settings.calendars.caldav.username.description')}
          </div>
        </div>
        <div className="setting-item-control">
          <UsernameInput value={username} onChange={setUsername} />
        </div>
      </div>

      <div className="setting-item">
        <div className="setting-item-info">
          <div className="setting-item-name">{t('settings.calendars.caldav.password.label')}</div>
          <div className="setting-item-description">
            {t('settings.calendars.caldav.password.description')}
          </div>
        </div>
        <div className="setting-item-control">
          <PasswordInput value={password} onChange={setPassword} />
        </div>
      </div>

      <div className="setting-item" style={{ borderTop: 'none', paddingTop: 0 }}>
        <div className="setting-item-info">
          <label style={{ fontSize: '0.85em', opacity: 0.8, cursor: 'pointer' }}>
            <input
              type="checkbox"
              checked={isManualMode}
              onChange={e => setIsManualMode(e.target.checked)}
              style={{ marginRight: '6px' }}
            />
            {t('settings.calendars.caldav.advancedToggle')}
          </label>
        </div>
        <div className="setting-item-control">
          <button
            className="mod-cta"
            type="submit"
            disabled={isSubmitting || !url || !username || !password}
          >
            {isSubmitting
              ? isManualMode
                ? t('settings.calendars.caldav.importing')
                : t('settings.calendars.caldav.discovering')
              : isManualMode
                ? mode === 'tasks'
                  ? t('settings.calendars.caldavTasks.importButton')
                  : t('settings.calendars.caldav.importButton')
                : t('settings.calendars.caldav.discoverButton')}
          </button>
        </div>
      </div>
    </form>
  );
};
