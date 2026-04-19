import {FC} from 'react';

import type {StocktakeDirBreakdown} from '@shared/types/Stocktake';

function formatSize(bytes: number): string {
  if (bytes === 0) return '0.00 B';
  const units = ['B', 'KB', 'MB', 'GB', 'TB', 'PB'];
  const i = Math.floor(Math.log(bytes) / Math.log(1024));
  return (bytes / Math.pow(1024, i)).toFixed(2) + ' ' + units[i];
}

interface StocktakeDiskUsageProps {
  dirBreakdown: StocktakeDirBreakdown[];
}

const StocktakeDiskUsage: FC<StocktakeDiskUsageProps> = ({dirBreakdown}: StocktakeDiskUsageProps) => {
  const totalSize = dirBreakdown.reduce((acc, d) => acc + d.totalSize, 0);

  return (
    <div className="stocktake__tab-content">
      <div className="stocktake__disk-cards">
        {dirBreakdown.map((dir) => {
          const tiedPct = dir.totalSize > 0 ? (dir.tiedSize / dir.totalSize) * 100 : 0;
          const untiedPct = dir.totalSize > 0 ? (dir.untiedSize / dir.totalSize) * 100 : 0;

          return (
            <div key={dir.sourceDir} className="stocktake__disk-card">
              <h4 className="stocktake__disk-dir">{dir.sourceDir}</h4>
              <div className="stocktake__disk-bar">
                <div
                  className="stocktake__disk-bar-tied"
                  style={{width: `${tiedPct}%`}}
                  title={`Tied: ${formatSize(dir.tiedSize)}`}
                />
                <div
                  className="stocktake__disk-bar-untied"
                  style={{width: `${untiedPct}%`}}
                  title={`Untied: ${formatSize(dir.untiedSize)}`}
                />
              </div>
              <div className="stocktake__disk-stats">
                <span>
                  <strong>{dir.totalCount}</strong> entries ({formatSize(dir.totalSize)})
                </span>
                <span className="stocktake__disk-tied">
                  {dir.tiedCount} tied ({formatSize(dir.tiedSize)})
                </span>
                <span className="stocktake__disk-untied">
                  {dir.untiedCount} untied ({formatSize(dir.untiedSize)})
                </span>
              </div>
            </div>
          );
        })}
      </div>
      <div className="stocktake__disk-total">Total across all directories: {formatSize(totalSize)}</div>
    </div>
  );
};

export default StocktakeDiskUsage;
