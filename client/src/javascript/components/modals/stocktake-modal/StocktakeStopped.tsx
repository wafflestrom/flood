import axios from 'axios';
import {FC, useCallback, useMemo, useState} from 'react';

import ConfigStore from '@client/stores/ConfigStore';
import type {StocktakeAddedTorrent, StocktakeTorrentMatch} from '@shared/types/Stocktake';

const {baseURI} = ConfigStore;

function formatSize(bytes: number): string {
  if (bytes === 0) return '0.00 B';
  const units = ['B', 'KB', 'MB', 'GB', 'TB', 'PB'];
  const i = Math.floor(Math.log(bytes) / Math.log(1024));
  return (bytes / Math.pow(1024, i)).toFixed(2) + ' ' + units[i];
}

function getTrackerHostname(t: StocktakeTorrentMatch): string {
  if (!t.trackerURIs[0]) return '';
  try {
    return new URL(t.trackerURIs[0]).hostname;
  } catch {
    return t.trackerURIs[0];
  }
}

type SortField = 'name' | 'size' | 'percentComplete' | 'tracker' | 'ratio' | 'tags';

type FilterMode = 'include' | 'exclude';

interface FilterSelection {
  values: Set<string>;
  mode: FilterMode;
}

interface StocktakeStoppedProps {
  stoppedTorrents: StocktakeTorrentMatch[];
  onTorrentAdded: (added: StocktakeAddedTorrent) => void;
}

const StocktakeStopped: FC<StocktakeStoppedProps> = ({stoppedTorrents, onTorrentAdded}: StocktakeStoppedProps) => {
  const [search, setSearch] = useState('');
  const [sortField, setSortField] = useState<SortField>('name');
  const [sortDir, setSortDir] = useState<'asc' | 'desc'>('asc');
  const [actionPending, setActionPending] = useState<Set<string>>(new Set());
  const [actionDone, setActionDone] = useState<Map<string, 'started' | 'checked' | 'error'>>(new Map());
  const [trackerFilter, setTrackerFilter] = useState<FilterSelection>({values: new Set(), mode: 'include'});
  const [tagFilter, setTagFilter] = useState<FilterSelection>({values: new Set(), mode: 'include'});

  const allTrackers = useMemo(() => {
    const set = new Set<string>();
    for (const t of stoppedTorrents) {
      const tracker = getTrackerHostname(t);
      if (tracker) set.add(tracker);
    }
    return Array.from(set).sort();
  }, [stoppedTorrents]);

  const allTags = useMemo(() => {
    const set = new Set<string>();
    for (const t of stoppedTorrents) {
      for (const tag of t.tags) {
        if (tag) set.add(tag);
      }
    }
    return Array.from(set).sort();
  }, [stoppedTorrents]);

  const filtered = useMemo(() => {
    let items = stoppedTorrents;

    if (trackerFilter.values.size > 0) {
      if (trackerFilter.mode === 'include') {
        items = items.filter((t) => trackerFilter.values.has(getTrackerHostname(t)));
      } else {
        items = items.filter((t) => !trackerFilter.values.has(getTrackerHostname(t)));
      }
    }

    if (tagFilter.values.size > 0) {
      if (tagFilter.mode === 'include') {
        items = items.filter((t) => t.tags.some((tag) => tagFilter.values.has(tag)));
      } else {
        items = items.filter((t) => !t.tags.some((tag) => tagFilter.values.has(tag)));
      }
    }

    if (search) {
      const q = search.toLowerCase();
      items = items.filter(
        (t) =>
          t.name.toLowerCase().includes(q) ||
          t.basePath.toLowerCase().includes(q) ||
          t.trackerURIs.some((u) => u.toLowerCase().includes(q)) ||
          t.tags.some((tag) => tag.toLowerCase().includes(q)),
      );
    }

    items = [...items].sort((a, b) => {
      let cmp = 0;
      switch (sortField) {
        case 'name':
          cmp = a.name.localeCompare(b.name);
          break;
        case 'size':
          cmp = a.sizeBytes - b.sizeBytes;
          break;
        case 'percentComplete':
          cmp = a.percentComplete - b.percentComplete;
          break;
        case 'tracker':
          cmp = getTrackerHostname(a).localeCompare(getTrackerHostname(b));
          break;
        case 'ratio':
          cmp = a.ratio - b.ratio;
          break;
        case 'tags':
          cmp = a.tags.join(',').localeCompare(b.tags.join(','));
          break;
      }
      return sortDir === 'asc' ? cmp : -cmp;
    });
    return items;
  }, [stoppedTorrents, search, sortField, sortDir, trackerFilter, tagFilter]);

  const handleSort = (field: SortField) => {
    if (sortField === field) {
      setSortDir(sortDir === 'asc' ? 'desc' : 'asc');
    } else {
      setSortField(field);
      setSortDir('asc');
    }
  };

  const sortIndicator = (field: SortField) => {
    if (sortField !== field) return '';
    return sortDir === 'asc' ? ' ▲' : ' ▼';
  };

  const toggleFilterValue = (filter: FilterSelection, setFilter: (f: FilterSelection) => void, value: string) => {
    const next = new Set(filter.values);
    if (next.has(value)) {
      next.delete(value);
    } else {
      next.add(value);
    }
    setFilter({...filter, values: next});
  };

  const toggleFilterMode = (filter: FilterSelection, setFilter: (f: FilterSelection) => void) => {
    setFilter({...filter, mode: filter.mode === 'include' ? 'exclude' : 'include'});
  };

  const handleCheckHash = useCallback(
    async (t: StocktakeTorrentMatch) => {
      setActionPending((prev) => new Set(prev).add(t.hash));
      try {
        await axios.post(`${baseURI}api/torrents/check-hash`, {hashes: [t.hash]});
        setActionDone((prev) => new Map(prev).set(t.hash, 'checked'));
        onTorrentAdded({
          name: t.name,
          size: t.sizeBytes,
          torrentFilePath: '',
          destination: t.basePath,
          addedAt: Date.now(),
          status: 'checked',
        });
      } catch (e) {
        setActionDone((prev) => new Map(prev).set(t.hash, 'error'));
        onTorrentAdded({
          name: t.name,
          size: t.sizeBytes,
          torrentFilePath: '',
          destination: t.basePath,
          addedAt: Date.now(),
          status: 'error',
          error: e instanceof Error ? e.message : 'Failed',
        });
      } finally {
        setActionPending((prev) => {
          const next = new Set(prev);
          next.delete(t.hash);
          return next;
        });
      }
    },
    [onTorrentAdded],
  );

  const handleStart = useCallback(
    async (t: StocktakeTorrentMatch) => {
      setActionPending((prev) => new Set(prev).add(t.hash));
      try {
        await axios.post(`${baseURI}api/torrents/start`, {hashes: [t.hash]});
        setActionDone((prev) => new Map(prev).set(t.hash, 'started'));
        onTorrentAdded({
          name: t.name,
          size: t.sizeBytes,
          torrentFilePath: '',
          destination: t.basePath,
          addedAt: Date.now(),
          status: 'added',
        });
      } catch (e) {
        setActionDone((prev) => new Map(prev).set(t.hash, 'error'));
        onTorrentAdded({
          name: t.name,
          size: t.sizeBytes,
          torrentFilePath: '',
          destination: t.basePath,
          addedAt: Date.now(),
          status: 'error',
          error: e instanceof Error ? e.message : 'Failed',
        });
      } finally {
        setActionPending((prev) => {
          const next = new Set(prev);
          next.delete(t.hash);
          return next;
        });
      }
    },
    [onTorrentAdded],
  );

  const totalSize = filtered.reduce((acc, t) => acc + t.sizeBytes, 0);
  const hasFilters = trackerFilter.values.size > 0 || tagFilter.values.size > 0;

  return (
    <div className="stocktake__tab-content">
      <p className="stocktake__description">
        These torrents are loaded in the client but stopped, and have matching files found on disk. The files may not be
        correct — run <strong>Check Hash</strong> to verify data integrity before starting. Torrents at 100% have
        already been verified and can be started directly.
      </p>
      <div className="stocktake__controls">
        <input
          className="stocktake__search"
          type="text"
          placeholder="Search stopped torrents..."
          value={search}
          onChange={(e) => setSearch(e.target.value)}
        />
        {hasFilters && (
          <button
            type="button"
            className="stocktake__btn-match"
            onClick={() => {
              setTrackerFilter({values: new Set(), mode: 'include'});
              setTagFilter({values: new Set(), mode: 'include'});
            }}
          >
            Clear filters
          </button>
        )}
      </div>

      {allTrackers.length > 0 && (
        <div className="stocktake__filter-row">
          <button
            type="button"
            className={`stocktake__filter-mode ${
              trackerFilter.mode === 'exclude' ? 'stocktake__filter-mode--exclude' : ''
            }`}
            onClick={() => toggleFilterMode(trackerFilter, setTrackerFilter)}
            title={`Click to switch to ${trackerFilter.mode === 'include' ? 'exclude' : 'include'} mode`}
          >
            {trackerFilter.mode === 'include' ? 'Tracker ✓' : 'Tracker ✗'}
          </button>
          <div className="stocktake__filter-chips">
            {allTrackers.map((tracker) => {
              const active = trackerFilter.values.has(tracker);
              return (
                <button
                  key={tracker}
                  type="button"
                  className={`stocktake__chip ${
                    active
                      ? trackerFilter.mode === 'exclude'
                        ? 'stocktake__chip--exclude'
                        : 'stocktake__chip--active'
                      : ''
                  }`}
                  onClick={() => toggleFilterValue(trackerFilter, setTrackerFilter, tracker)}
                >
                  {tracker}
                </button>
              );
            })}
          </div>
        </div>
      )}
      {allTags.length > 0 && (
        <div className="stocktake__filter-row">
          <button
            type="button"
            className={`stocktake__filter-mode ${
              tagFilter.mode === 'exclude' ? 'stocktake__filter-mode--exclude' : ''
            }`}
            onClick={() => toggleFilterMode(tagFilter, setTagFilter)}
            title={`Click to switch to ${tagFilter.mode === 'include' ? 'exclude' : 'include'} mode`}
          >
            {tagFilter.mode === 'include' ? 'Tags ✓' : 'Tags ✗'}
          </button>
          <div className="stocktake__filter-chips">
            {allTags.map((tag) => {
              const active = tagFilter.values.has(tag);
              return (
                <button
                  key={tag}
                  type="button"
                  className={`stocktake__chip ${
                    active
                      ? tagFilter.mode === 'exclude'
                        ? 'stocktake__chip--exclude'
                        : 'stocktake__chip--active'
                      : ''
                  }`}
                  onClick={() => toggleFilterValue(tagFilter, setTagFilter, tag)}
                >
                  {tag}
                </button>
              );
            })}
          </div>
        </div>
      )}

      <div className="stocktake__count">
        {filtered.length} stopped torrent{filtered.length !== 1 ? 's' : ''} with data on disk ({formatSize(totalSize)})
      </div>
      <div className="stocktake__table-wrapper">
        <table className="stocktake__table">
          <thead>
            <tr>
              <th onClick={() => handleSort('name')} className="stocktake__th-sortable">
                Name{sortIndicator('name')}
              </th>
              <th onClick={() => handleSort('size')} className="stocktake__th-sortable stocktake__th-right">
                Size{sortIndicator('size')}
              </th>
              <th onClick={() => handleSort('percentComplete')} className="stocktake__th-sortable stocktake__th-right">
                Progress{sortIndicator('percentComplete')}
              </th>
              <th onClick={() => handleSort('ratio')} className="stocktake__th-sortable stocktake__th-right">
                Ratio{sortIndicator('ratio')}
              </th>
              <th onClick={() => handleSort('tracker')} className="stocktake__th-sortable">
                Tracker{sortIndicator('tracker')}
              </th>
              <th onClick={() => handleSort('tags')} className="stocktake__th-sortable">
                Tags{sortIndicator('tags')}
              </th>
              <th>Action</th>
            </tr>
          </thead>
          <tbody>
            {filtered.map((t) => {
              const pct = Math.round(t.percentComplete);
              const pending = actionPending.has(t.hash);
              const done = actionDone.get(t.hash);
              return (
                <tr key={t.hash} className="stocktake__row--matched-loaded">
                  <td className="stocktake__td-name" title={t.basePath}>
                    {t.name}
                  </td>
                  <td className="stocktake__table-right">{formatSize(t.sizeBytes)}</td>
                  <td className="stocktake__table-right">
                    <span
                      className={`stocktake__badge ${
                        pct >= 100 ? 'stocktake__badge--success' : 'stocktake__badge--info'
                      }`}
                    >
                      {pct}%
                    </span>
                  </td>
                  <td className="stocktake__table-right">{(t.ratio / 1000).toFixed(2)}</td>
                  <td className="stocktake__td-tracker">{getTrackerHostname(t) || '—'}</td>
                  <td className="stocktake__td-tags">
                    {t.tags.length > 0
                      ? t.tags.map((tag) => (
                          <span key={tag} className="stocktake__badge stocktake__badge--muted">
                            {tag}
                          </span>
                        ))
                      : '—'}
                  </td>
                  <td>
                    {pct >= 100 ? (
                      <button
                        type="button"
                        className={done === 'error' ? 'stocktake__btn-check' : 'stocktake__btn-add'}
                        disabled={pending || !!done}
                        onClick={() => handleStart(t)}
                      >
                        {pending ? 'Starting…' : done === 'started' ? 'Started' : done === 'error' ? 'Failed' : 'Start'}
                      </button>
                    ) : (
                      <button
                        type="button"
                        className={done === 'error' ? 'stocktake__btn-add' : 'stocktake__btn-check'}
                        disabled={pending || !!done}
                        onClick={() => handleCheckHash(t)}
                      >
                        {pending
                          ? 'Checking…'
                          : done === 'checked'
                          ? 'Checking'
                          : done === 'error'
                          ? 'Failed'
                          : 'Check Hash'}
                      </button>
                    )}
                  </td>
                </tr>
              );
            })}
            {filtered.length === 0 && (
              <tr>
                <td colSpan={7} className="stocktake__empty">
                  No stopped torrents match your filters.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
};

export default StocktakeStopped;
