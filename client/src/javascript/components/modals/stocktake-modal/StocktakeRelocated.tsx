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

type SortField = 'name' | 'size' | 'tracker' | 'currentPath' | 'suggestedPath';

interface StocktakeRelocatedProps {
  relocatedTorrents: StocktakeTorrentMatch[];
  onTorrentAdded: (added: StocktakeAddedTorrent) => void;
}

const StocktakeRelocated: FC<StocktakeRelocatedProps> = ({
  relocatedTorrents,
  onTorrentAdded,
}: StocktakeRelocatedProps) => {
  const [search, setSearch] = useState('');
  const [sortField, setSortField] = useState<SortField>('name');
  const [sortDir, setSortDir] = useState<'asc' | 'desc'>('asc');
  const [actionPending, setActionPending] = useState<Set<string>>(new Set());
  const [actionDone, setActionDone] = useState<Map<string, 'moved' | 'error'>>(new Map());

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

  const filtered = useMemo(() => {
    let items = relocatedTorrents;
    if (search) {
      const q = search.toLowerCase();
      items = items.filter(
        (t) =>
          t.name.toLowerCase().includes(q) ||
          t.basePath.toLowerCase().includes(q) ||
          (t.suggestedPath ?? '').toLowerCase().includes(q) ||
          t.trackerURIs.some((u) => u.toLowerCase().includes(q)),
      );
    }
    return [...items].sort((a, b) => {
      let cmp = 0;
      switch (sortField) {
        case 'name':
          cmp = a.name.localeCompare(b.name);
          break;
        case 'size':
          cmp = a.sizeBytes - b.sizeBytes;
          break;
        case 'tracker':
          cmp = getTrackerHostname(a).localeCompare(getTrackerHostname(b));
          break;
        case 'currentPath':
          cmp = a.basePath.localeCompare(b.basePath);
          break;
        case 'suggestedPath':
          cmp = (a.suggestedPath ?? '').localeCompare(b.suggestedPath ?? '');
          break;
      }
      return sortDir === 'asc' ? cmp : -cmp;
    });
  }, [relocatedTorrents, search, sortField, sortDir]);

  const handleRepointAndCheck = useCallback(
    async (t: StocktakeTorrentMatch) => {
      if (!t.suggestedPath) return;
      setActionPending((prev) => new Set(prev).add(t.hash));
      try {
        await axios.post(`${baseURI}api/torrents/move`, {
          hashes: [t.hash],
          destination: t.suggestedPath,
          moveFiles: false,
          isBasePath: false,
          isCheckHash: true,
        });
        setActionDone((prev) => new Map(prev).set(t.hash, 'moved'));
        onTorrentAdded({
          name: t.name,
          size: t.sizeBytes,
          torrentFilePath: '',
          destination: t.suggestedPath,
          addedAt: Date.now(),
          status: 'checked',
        });
      } catch (e) {
        setActionDone((prev) => new Map(prev).set(t.hash, 'error'));
        onTorrentAdded({
          name: t.name,
          size: t.sizeBytes,
          torrentFilePath: '',
          destination: t.suggestedPath,
          addedAt: Date.now(),
          status: 'error',
          error: e instanceof Error ? e.message : 'Move failed',
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
      <p className="stocktake__description">
        These torrents point to the wrong directory but matching files were found elsewhere by name. Click{' '}
        <strong>Repoint &amp; Hash</strong> to update the torrent&apos;s base directory to where the files actually are
        and trigger a hash check. No files are moved — only the torrent&apos;s directory setting changes.
      </p>
      <div className="stocktake__controls">
        <input
          className="stocktake__search"
          type="text"
          placeholder="Search repointable torrents..."
          value={search}
          onChange={(e) => setSearch(e.target.value)}
        />
      </div>
      <div className="stocktake__count">
        {filtered.length} repointable torrent{filtered.length !== 1 ? 's' : ''} ({formatSize(totalSize)})
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
              <th onClick={() => handleSort('currentPath')} className="stocktake__th-sortable">
                Current Path{sortIndicator('currentPath')}
              </th>
              <th onClick={() => handleSort('suggestedPath')} className="stocktake__th-sortable">
                Found At{sortIndicator('suggestedPath')}
              </th>
              <th onClick={() => handleSort('tracker')} className="stocktake__th-sortable">
                Tracker{sortIndicator('tracker')}
              </th>
              <th>Action</th>
            </tr>
          </thead>
          <tbody>
            {filtered.map((t) => {
              const pending = actionPending.has(t.hash);
              const done = actionDone.get(t.hash);
              return (
                <tr key={t.hash} className="stocktake__row--relocated">
                  <td className="stocktake__td-name" title={t.hash}>
                    {t.name}
                  </td>
                  <td className="stocktake__table-right">{formatSize(t.sizeBytes)}</td>
                  <td className="stocktake__td-path" title={t.basePath}>
                    {t.basePath}
                  </td>
                  <td className="stocktake__td-path" title={t.suggestedPath ?? ''}>
                    {t.suggestedPath ?? '—'}
                  </td>
                  <td className="stocktake__td-tracker">{getTrackerHostname(t) || '—'}</td>
                  <td>
                    <button
                      type="button"
                      className={done === 'error' ? 'stocktake__btn-check' : 'stocktake__btn-add'}
                      disabled={pending || !!done}
                      onClick={() => handleRepointAndCheck(t)}
                    >
                      {pending
                        ? 'Hashing…'
                        : done === 'moved'
                        ? 'Done ✓'
                        : done === 'error'
                        ? 'Failed'
                        : 'Repoint & Hash'}
                    </button>
                  </td>
                </tr>
              );
            })}
            {filtered.length === 0 && (
              <tr>
                <td colSpan={6} className="stocktake__empty">
                  No repointable torrents found. All torrents point to the correct location.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
};

export default StocktakeRelocated;
