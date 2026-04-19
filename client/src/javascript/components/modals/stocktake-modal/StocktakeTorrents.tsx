import {FC, useMemo, useState} from 'react';

import type {StocktakeTorrentMatch} from '@shared/types/Stocktake';

function formatSize(bytes: number): string {
  if (bytes === 0) return '0.00 B';
  const units = ['B', 'KB', 'MB', 'GB', 'TB', 'PB'];
  const i = Math.floor(Math.log(bytes) / Math.log(1024));
  return (bytes / Math.pow(1024, i)).toFixed(2) + ' ' + units[i];
}

type SortField = 'name' | 'size' | 'status' | 'ratio' | 'percentComplete';

interface StocktakeTorrentsProps {
  allTorrents: StocktakeTorrentMatch[];
}

const statusColors: Record<string, string> = {
  seeding: 'stocktake__badge--success',
  stopped: 'stocktake__badge--muted',
  downloading: 'stocktake__badge--info',
  orphaned: 'stocktake__badge--danger',
  error: 'stocktake__badge--danger',
  hashing: 'stocktake__badge--warning',
};

const StocktakeTorrents: FC<StocktakeTorrentsProps> = ({allTorrents}: StocktakeTorrentsProps) => {
  const [search, setSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState<string>('all');
  const [sortField, setSortField] = useState<SortField>('name');
  const [sortDir, setSortDir] = useState<'asc' | 'desc'>('asc');

  const statuses = useMemo(() => {
    const s = new Set(allTorrents.map((t) => t.status));
    return Array.from(s).sort();
  }, [allTorrents]);

  const filtered = useMemo(() => {
    let items = allTorrents;
    if (statusFilter !== 'all') {
      items = items.filter((t) => t.status === statusFilter);
    }
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
        case 'status':
          cmp = a.status.localeCompare(b.status);
          break;
        case 'ratio':
          cmp = a.ratio - b.ratio;
          break;
        case 'percentComplete':
          cmp = a.percentComplete - b.percentComplete;
          break;
      }
      return sortDir === 'asc' ? cmp : -cmp;
    });
    return items;
  }, [allTorrents, search, statusFilter, sortField, sortDir]);

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

  return (
    <div className="stocktake__tab-content">
      <div className="stocktake__controls">
        <input
          className="stocktake__search"
          type="text"
          placeholder="Search torrents..."
          value={search}
          onChange={(e) => setSearch(e.target.value)}
        />
        <select className="stocktake__select" value={statusFilter} onChange={(e) => setStatusFilter(e.target.value)}>
          <option value="all">All statuses</option>
          {statuses.map((s) => (
            <option key={s} value={s}>
              {s}
            </option>
          ))}
        </select>
      </div>
      <div className="stocktake__count">
        {filtered.length} torrent{filtered.length !== 1 ? 's' : ''} (
        {formatSize(filtered.reduce((acc, t) => acc + t.sizeBytes, 0))})
      </div>
      <div className="stocktake__table-wrapper">
        <table className="stocktake__table">
          <thead>
            <tr>
              <th onClick={() => handleSort('name')} className="stocktake__th-sortable">
                Name{sortIndicator('name')}
              </th>
              <th onClick={() => handleSort('status')} className="stocktake__th-sortable">
                Status{sortIndicator('status')}
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
              <th>Trackers</th>
            </tr>
          </thead>
          <tbody>
            {filtered.map((t) => (
              <tr key={t.hash} className={!t.filesOnDisk ? 'stocktake__row--missing' : ''}>
                <td className="stocktake__td-name" title={t.basePath}>
                  {t.name}
                </td>
                <td>
                  <span className={`stocktake__badge ${statusColors[t.status] || ''}`}>{t.status}</span>
                </td>
                <td className="stocktake__table-right">{formatSize(t.sizeBytes)}</td>
                <td className="stocktake__table-right">{t.percentComplete.toFixed(1)}%</td>
                <td className="stocktake__table-right">{(t.ratio / 1000).toFixed(2)}</td>
                <td className="stocktake__td-tracker">{t.trackerURIs.join(', ') || '—'}</td>
              </tr>
            ))}
            {filtered.length === 0 && (
              <tr>
                <td colSpan={6} className="stocktake__empty">
                  No torrents match your filters.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
};

export default StocktakeTorrents;
