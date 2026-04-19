import {FC} from 'react';

import type {StocktakeSummary} from '@shared/types/Stocktake';

function formatSize(bytes: number): string {
  if (bytes === 0) return '0.00 B';
  const units = ['B', 'KB', 'MB', 'GB', 'TB', 'PB'];
  const i = Math.floor(Math.log(bytes) / Math.log(1024));
  return (bytes / Math.pow(1024, i)).toFixed(2) + ' ' + units[i];
}

interface StocktakeDashboardProps {
  summary: StocktakeSummary;
  scanDirs: string[];
}

const StocktakeDashboard: FC<StocktakeDashboardProps> = ({summary, scanDirs}: StocktakeDashboardProps) => {
  return (
    <div className="stocktake__dashboard">
      <div className="stocktake__stat-grid">
        <div className="stocktake__stat-card">
          <div className="stocktake__stat-value">{summary.totalTorrents.toLocaleString()}</div>
          <div className="stocktake__stat-label">Total Torrents</div>
        </div>
        <div className="stocktake__stat-card">
          <div className="stocktake__stat-value">{summary.totalDiskEntries.toLocaleString()}</div>
          <div className="stocktake__stat-label">Disk Entries</div>
        </div>
        <div className="stocktake__stat-card stocktake__stat-card--warning">
          <div className="stocktake__stat-value">{summary.untiedCount}</div>
          <div className="stocktake__stat-label">Untied Files</div>
        </div>
        <div className="stocktake__stat-card stocktake__stat-card--danger">
          <div className="stocktake__stat-value">{summary.orphanedCount}</div>
          <div className="stocktake__stat-label">Orphaned Torrents</div>
        </div>
        <div className="stocktake__stat-card stocktake__stat-card--success">
          <div className="stocktake__stat-value">{summary.seedingCount}</div>
          <div className="stocktake__stat-label">Seeding</div>
        </div>
        <div className="stocktake__stat-card">
          <div className="stocktake__stat-value">{summary.stoppedCount}</div>
          <div className="stocktake__stat-label">Stopped</div>
        </div>
        <div className="stocktake__stat-card">
          <div className="stocktake__stat-value">{summary.downloadingCount}</div>
          <div className="stocktake__stat-label">Downloading</div>
        </div>
        <div className="stocktake__stat-card stocktake__stat-card--danger">
          <div className="stocktake__stat-value">{summary.errorCount}</div>
          <div className="stocktake__stat-label">Errors</div>
        </div>
        <div className="stocktake__stat-card stocktake__stat-card--muted">
          <div className="stocktake__stat-value">{summary.outsideCount}</div>
          <div className="stocktake__stat-label">Outside Scan Dirs</div>
        </div>
      </div>

      <div className="stocktake__size-summary">
        <h4>Disk Usage</h4>
        <table className="stocktake__table stocktake__table--compact">
          <tbody>
            <tr>
              <td>Total Disk</td>
              <td className="stocktake__table-right">{formatSize(summary.totalDiskSize)}</td>
            </tr>
            <tr>
              <td>Tied to Torrents</td>
              <td className="stocktake__table-right">{formatSize(summary.tiedDiskSize)}</td>
            </tr>
            <tr>
              <td>Untied</td>
              <td className="stocktake__table-right">{formatSize(summary.untiedDiskSize)}</td>
            </tr>
            <tr>
              <td>Torrent Total Size</td>
              <td className="stocktake__table-right">{formatSize(summary.torrentTotalSize)}</td>
            </tr>
          </tbody>
        </table>
      </div>

      <div className="stocktake__info">
        <h4>Scanned Directories</h4>
        <ul className="stocktake__dir-list">
          {scanDirs.map((dir) => (
            <li key={dir}>{dir}</li>
          ))}
        </ul>
        <p className="stocktake__scan-time">Scan completed in {summary.scanTime.toFixed(1)}s</p>
      </div>
    </div>
  );
};

export default StocktakeDashboard;
