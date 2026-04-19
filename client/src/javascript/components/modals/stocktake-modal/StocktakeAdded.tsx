import {FC} from 'react';

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

interface StocktakeAddedProps {
  addedTorrents: StocktakeAddedTorrent[];
}

const StocktakeAdded: FC<StocktakeAddedProps> = ({addedTorrents}: StocktakeAddedProps) => {
  return (
    <div className="stocktake__tab-content">
      <div className="stocktake__count">
        {addedTorrents.length} torrent{addedTorrents.length !== 1 ? 's' : ''} added this session
      </div>
      <div className="stocktake__table-wrapper">
        <table className="stocktake__table">
          <thead>
            <tr>
              <th>Name</th>
              <th className="stocktake__th-right">Size</th>
              <th>Source .torrent</th>
              <th>Destination</th>
              <th>Time</th>
              <th>Status</th>
            </tr>
          </thead>
          <tbody>
            {addedTorrents.map((t) => (
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
                      t.status === 'added' ? 'stocktake__badge--success' : 'stocktake__badge--danger'
                    }`}
                  >
                    {t.status === 'added' ? 'hashing' : 'error'}
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
