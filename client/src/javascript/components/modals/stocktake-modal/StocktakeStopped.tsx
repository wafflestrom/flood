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

type SortField = 'name' | 'size' | 'percentComplete' | 'tracker' | 'ratio';

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

  const getTracker = useCallback((t: StocktakeTorrentMatch): string => {
    if (!t.trackerURIs[0]) return '';
    try {
      return new URL(t.trackerURIs[0]).hostname;
    } catch {
      return t.trackerURIs[0];
    }
  }, []);

  const filtered = useMemo(() => {
    let items = stoppedTorrents;
    if (search) {
      const q = search.toLowerCase();
      items = items.filter(
        (t) =>
          t.name.toLowerCase().includes(q) ||
          t.basePath.toLowerCase().includes(q) ||
          t.trackerURIs.some((u) => u.toLowerCase().includes(q)),
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
          cmp = getTracker(a).localeCompare(getTracker(b));
          break;
        case 'ratio':
          cmp = a.ratio - b.ratio;
          break;
      }
      return sortDir === 'asc' ? cmp : -cmp;
    });
    return items;
  }, [stoppedTorrents, search, sortField, sortDir, getTracker]);

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

  return (
    <div className="stocktake__tab-content">
      <div className="stocktake__controls">
        <input
          className="stocktake__search"
          type="text"
          placeholder="Search stopped torrents..."
          value={search}
          onChange={(e) => setSearch(e.target.value)}
        />
      </div>
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
                  <td className="stocktake__td-tracker">{getTracker(t) || '—'}</td>
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
                <td colSpan={6} className="stocktake__empty">
                  No stopped torrents with data on disk.
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
