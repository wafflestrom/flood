import {FC, useMemo, useState} from 'react';

import type {StocktakeAddedTorrent} from '@shared/types/Stocktake';

function formatSize(bytes: number): string {
  if (bytes === 0) return '0.00 B';
  const units = ['B', 'KB', 'MB', 'GB', 'TB', 'PB'];
  const i = Math.floor(Math.log(bytes) / Math.log(1024));
  return (bytes / Math.pow(1024, i)).toFixed(2) + ' ' + units[i];
}

function formatTime(timestamp: number): string {
  return new Date(timestamp).toLocaleTimeString(undefined, {
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  });
}

type AddedSortField = 'name' | 'size' | 'torrentFilePath' | 'destination' | 'addedAt' | 'status';

interface StocktakeAddedProps {
  addedTorrents: StocktakeAddedTorrent[];
}

const StocktakeAdded: FC<StocktakeAddedProps> = ({addedTorrents}: StocktakeAddedProps) => {
  const [sortField, setSortField] = useState<AddedSortField>('addedAt');
  const [sortDir, setSortDir] = useState<'asc' | 'desc'>('desc');

  const handleSort = (field: AddedSortField) => {
    if (sortField === field) {
      setSortDir(sortDir === 'asc' ? 'desc' : 'asc');
    } else {
      setSortField(field);
      setSortDir('asc');
    }
  };

  const sortIndicator = (field: AddedSortField) => {
    if (sortField !== field) return '';
    return sortDir === 'asc' ? ' ▲' : ' ▼';
  };

  const sorted = useMemo(() => {
    return [...addedTorrents].sort((a, b) => {
      let cmp = 0;
      switch (sortField) {
        case 'name':
          cmp = a.name.localeCompare(b.name);
          break;
        case 'size':
          cmp = a.size - b.size;
          break;
        case 'torrentFilePath':
          cmp = a.torrentFilePath.localeCompare(b.torrentFilePath);
          break;
        case 'destination':
          cmp = a.destination.localeCompare(b.destination);
          break;
        case 'addedAt':
          cmp = a.addedAt - b.addedAt;
          break;
        case 'status':
          cmp = a.status.localeCompare(b.status);
          break;
      }
      return sortDir === 'asc' ? cmp : -cmp;
    });
  }, [addedTorrents, sortField, sortDir]);

  return (
    <div className="stocktake__tab-content">
      <div className="stocktake__count">
        {addedTorrents.length} torrent{addedTorrents.length !== 1 ? 's' : ''} added this session
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
              <th onClick={() => handleSort('torrentFilePath')} className="stocktake__th-sortable">
                Source .torrent{sortIndicator('torrentFilePath')}
              </th>
              <th onClick={() => handleSort('destination')} className="stocktake__th-sortable">
                Destination{sortIndicator('destination')}
              </th>
              <th onClick={() => handleSort('addedAt')} className="stocktake__th-sortable">
                Time{sortIndicator('addedAt')}
              </th>
              <th onClick={() => handleSort('status')} className="stocktake__th-sortable">
                Status{sortIndicator('status')}
              </th>
            </tr>
          </thead>
          <tbody>
            {sorted.map((t) => (
              <tr key={t.torrentFilePath + t.addedAt}>
                <td className="stocktake__td-name" title={t.name}>
                  {t.name}
                </td>
                <td className="stocktake__table-right">{formatSize(t.size)}</td>
                <td className="stocktake__td-path" title={t.torrentFilePath}>
                  {t.torrentFilePath}
                </td>
                <td className="stocktake__td-dir" title={t.destination}>
                  {t.destination}
                </td>
                <td>{formatTime(t.addedAt)}</td>
                <td>
                  <span
                    className={`stocktake__badge ${
                      t.status === 'error'
                        ? 'stocktake__badge--danger'
                        : t.status === 'checked'
                        ? 'stocktake__badge--info'
                        : 'stocktake__badge--success'
                    }`}
                  >
                    {t.status === 'added' ? 'hashing' : t.status === 'checked' ? 'rechecking' : 'error'}
                  </span>
                  {t.error && (
                    <span className="stocktake__error-hint" title={t.error}>
                      {' '}
                      ⚠
                    </span>
                  )}
                </td>
              </tr>
            ))}
            {addedTorrents.length === 0 && (
              <tr>
                <td colSpan={6} className="stocktake__empty">
                  No torrents have been added via matching yet. Use the &quot;Match .torrents&quot; feature on the
                  Untied tab to find and add matching torrent files.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
};

export default StocktakeAdded;
