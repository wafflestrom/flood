import {FC, useMemo, useState} from 'react';

import type {StocktakeTorrentMatch} from '@shared/types/Stocktake';

function formatSize(bytes: number): string {
  if (bytes === 0) return '0.00 B';
  const units = ['B', 'KB', 'MB', 'GB', 'TB', 'PB'];
  const i = Math.floor(Math.log(bytes) / Math.log(1024));
  return (bytes / Math.pow(1024, i)).toFixed(2) + ' ' + units[i];
}

interface StocktakeOrphanedProps {
  orphanedTorrents: StocktakeTorrentMatch[];
}

const StocktakeOrphaned: FC<StocktakeOrphanedProps> = ({orphanedTorrents}: StocktakeOrphanedProps) => {
  const [search, setSearch] = useState('');

  const filtered = useMemo(() => {
    if (!search) return orphanedTorrents;
    const q = search.toLowerCase();
    return orphanedTorrents.filter(
      (t) =>
        t.name.toLowerCase().includes(q) ||
        t.basePath.toLowerCase().includes(q) ||
        t.trackerURIs.some((u) => u.toLowerCase().includes(q)),
    );
  }, [orphanedTorrents, search]);

  return (
    <div className="stocktake__tab-content">
      <div className="stocktake__controls">
        <input
          className="stocktake__search"
          type="text"
          placeholder="Search orphaned torrents..."
          value={search}
          onChange={(e) => setSearch(e.target.value)}
        />
      </div>
      <div className="stocktake__count">
        {filtered.length} orphaned torrent{filtered.length !== 1 ? 's' : ''} (
        {formatSize(filtered.reduce((acc, t) => acc + t.sizeBytes, 0))})
      </div>
      <div className="stocktake__table-wrapper">
        <table className="stocktake__table">
          <thead>
            <tr>
              <th>Name</th>
              <th className="stocktake__th-right">Size</th>
              <th>Expected Path</th>
              <th>Trackers</th>
            </tr>
          </thead>
          <tbody>
            {filtered.map((t) => (
              <tr key={t.hash}>
                <td className="stocktake__td-name" title={t.hash}>
                  {t.name}
                </td>
                <td className="stocktake__table-right">{formatSize(t.sizeBytes)}</td>
                <td className="stocktake__td-path" title={t.basePath}>
                  {t.basePath}
                </td>
                <td className="stocktake__td-tracker">{t.trackerURIs.join(', ') || '—'}</td>
              </tr>
            ))}
            {filtered.length === 0 && (
              <tr>
                <td colSpan={4} className="stocktake__empty">
                  No orphaned torrents. All complete torrents have files on disk.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
};

export default StocktakeOrphaned;
