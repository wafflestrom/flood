import {FC, useMemo} from 'react';

import type {StocktakeDirBreakdown, StocktakeDiskEntry, StocktakeMatchResult} from '@shared/types/Stocktake';

function formatSize(bytes: number): string {
  if (bytes === 0) return '0.00 B';
  const units = ['B', 'KB', 'MB', 'GB', 'TB', 'PB'];
  const i = Math.floor(Math.log(bytes) / Math.log(1024));
  return (bytes / Math.pow(1024, i)).toFixed(2) + ' ' + units[i];
}

interface StocktakeDiskUsageProps {
  dirBreakdown: StocktakeDirBreakdown[];
  untiedFiles: StocktakeDiskEntry[];
  matchResult: StocktakeMatchResult | null;
}

interface MatchedBreakdown {
  matchedCount: number;
  matchedSize: number;
  unmatchedCount: number;
  unmatchedSize: number;
  filteredCount: number;
  filteredSize: number;
}

const StocktakeDiskUsage: FC<StocktakeDiskUsageProps> = ({
  dirBreakdown,
  untiedFiles,
  matchResult,
}: StocktakeDiskUsageProps) => {
  const totalSize = dirBreakdown.reduce((acc, d) => acc + d.totalSize, 0);

  // Compute per-directory matched/unmatched breakdown from match results
  const matchBreakdownByDir = useMemo(() => {
    if (!matchResult) return null;
    const matchedPaths = new Set(matchResult.matches.map((m) => m.untiedPath));
    const filteredPaths = new Set(matchResult.filteredUntiedPaths ?? []);
    const byDir = new Map<string, MatchedBreakdown>();

    for (const f of untiedFiles) {
      const entry = byDir.get(f.sourceDir) ?? {
        matchedCount: 0,
        matchedSize: 0,
        unmatchedCount: 0,
        unmatchedSize: 0,
        filteredCount: 0,
        filteredSize: 0,
      };

      if (filteredPaths.has(f.path)) {
        entry.filteredCount++;
        entry.filteredSize += f.size;
      } else if (matchedPaths.has(f.path)) {
        entry.matchedCount++;
        entry.matchedSize += f.size;
      } else {
        entry.unmatchedCount++;
        entry.unmatchedSize += f.size;
      }

      byDir.set(f.sourceDir, entry);
    }

    return byDir;
  }, [matchResult, untiedFiles]);

  return (
    <div className="stocktake__tab-content">
      <div className="stocktake__disk-cards">
        {dirBreakdown.map((dir) => {
          const mb = matchBreakdownByDir?.get(dir.sourceDir);
          const tiedPct = dir.totalSize > 0 ? (dir.tiedSize / dir.totalSize) * 100 : 0;

          if (mb) {
            // After matching: split untied into matched (blue), filtered (green), unmatched (amber)
            const matchedPct = dir.totalSize > 0 ? (mb.matchedSize / dir.totalSize) * 100 : 0;
            const filteredPct = dir.totalSize > 0 ? (mb.filteredSize / dir.totalSize) * 100 : 0;
            const unmatchedPct = dir.totalSize > 0 ? (mb.unmatchedSize / dir.totalSize) * 100 : 0;

            return (
              <div key={dir.sourceDir} className="stocktake__disk-card">
                <h4 className="stocktake__disk-dir">{dir.sourceDir}</h4>
                <div className="stocktake__disk-bar">
                  <div
                    className="stocktake__disk-bar-tied"
                    style={{width: `${tiedPct + filteredPct}%`}}
                    title={`Tied: ${formatSize(dir.tiedSize + mb.filteredSize)}`}
                  />
                  <div
                    className="stocktake__disk-bar-matched"
                    style={{width: `${matchedPct}%`}}
                    title={`Matched: ${formatSize(mb.matchedSize)}`}
                  />
                  <div
                    className="stocktake__disk-bar-untied"
                    style={{width: `${unmatchedPct}%`}}
                    title={`Unmatched: ${formatSize(mb.unmatchedSize)}`}
                  />
                </div>
                <div className="stocktake__disk-stats">
                  <span>
                    <strong>{dir.totalCount}</strong> entries ({formatSize(dir.totalSize)})
                  </span>
                  <span className="stocktake__disk-tied">
                    {dir.tiedCount + mb.filteredCount} tied ({formatSize(dir.tiedSize + mb.filteredSize)})
                  </span>
                  <span className="stocktake__disk-matched">
                    {mb.matchedCount} matched ({formatSize(mb.matchedSize)})
                  </span>
                  <span className="stocktake__disk-untied">
                    {mb.unmatchedCount} unmatched ({formatSize(mb.unmatchedSize)})
                  </span>
                </div>
              </div>
            );
          }

          // Before matching: original view
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
      {matchBreakdownByDir && (
        <div className="stocktake__disk-legend">
          <span className="stocktake__disk-legend-item stocktake__disk-tied">■ Tied</span>
          <span className="stocktake__disk-legend-item stocktake__disk-matched">■ Matched (.torrent found)</span>
          <span className="stocktake__disk-legend-item stocktake__disk-untied">■ Unmatched</span>
        </div>
      )}
      <div className="stocktake__disk-total">Total across all directories: {formatSize(totalSize)}</div>
    </div>
  );
};

export default StocktakeDiskUsage;
