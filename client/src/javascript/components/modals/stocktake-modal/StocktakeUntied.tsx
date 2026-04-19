import axios from 'axios';
import {FC, useCallback, useEffect, useMemo, useRef, useState} from 'react';

import ConfigStore from '@client/stores/ConfigStore';
import type {
  StocktakeAddedTorrent,
  StocktakeDiskEntry,
  StocktakeMatch,
  StocktakeMatchResult,
} from '@shared/types/Stocktake';

const {baseURI} = ConfigStore;

function formatSize(bytes: number): string {
  if (bytes === 0) return '0.00 B';
  const units = ['B', 'KB', 'MB', 'GB', 'TB', 'PB'];
  const i = Math.floor(Math.log(bytes) / Math.log(1024));
  return (bytes / Math.pow(1024, i)).toFixed(2) + ' ' + units[i];
}

function formatDate(timestamp: number): string {
  return new Date(timestamp * 1000).toLocaleDateString(undefined, {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
  });
}

type SortField = 'name' | 'size' | 'mtime' | 'sourceDir' | 'tracker';

interface StocktakeUntiedProps {
  untiedFiles: StocktakeDiskEntry[];
  matchResult: StocktakeMatchResult | null;
  isMatching: boolean;
  matchError: string | null;
  torrentDir: string;
  onTorrentDirChange: (dir: string) => void;
  onRunMatch: () => void;
  onTorrentAdded: (added: StocktakeAddedTorrent) => void;
}

const StocktakeUntied: FC<StocktakeUntiedProps> = ({
  untiedFiles,
  matchResult,
  isMatching,
  matchError,
  torrentDir,
  onTorrentDirChange,
  onRunMatch,
  onTorrentAdded,
}: StocktakeUntiedProps) => {
  const [search, setSearch] = useState('');
  const [sortField, setSortField] = useState<SortField>('name');
  const [sortDir, setSortDir] = useState<'asc' | 'desc'>('asc');
  const [dirFilter, setDirFilter] = useState<string>('all');
  const [addingPaths, setAddingPaths] = useState<Set<string>>(new Set());
  const [completedPaths, setCompletedPaths] = useState<Map<string, 'added' | 'checked' | 'error'>>(new Map());
  const [showFilter, setShowFilter] = useState<'all' | 'matched' | 'unmatched'>('all');
  const prevMatchResult = useRef(matchResult);

  useEffect(() => {
    if (matchResult && matchResult !== prevMatchResult.current && matchResult.matches.length >= 1) {
      setShowFilter('matched');
    }
    prevMatchResult.current = matchResult;
  }, [matchResult]);

  const matchByPath = useMemo(() => {
    if (!matchResult) return new Map<string, StocktakeMatch>();
    const map = new Map<string, StocktakeMatch>();
    for (const m of matchResult.matches) {
      map.set(m.untiedPath, m);
    }
    return map;
  }, [matchResult]);

  const sourceDirs = useMemo(() => {
    const dirs = new Set(untiedFiles.map((f) => f.sourceDir));
    return Array.from(dirs).sort();
  }, [untiedFiles]);

  const filteredPaths = useMemo(() => {
    if (!matchResult?.filteredUntiedPaths?.length) return null;
    return new Set(matchResult.filteredUntiedPaths);
  }, [matchResult]);

  const getTracker = useCallback(
    (f: StocktakeDiskEntry): string => {
      const match = matchByPath.get(f.path);
      if (!match?.torrentFile.trackers[0]) return '';
      try {
        return new URL(match.torrentFile.trackers[0]).hostname;
      } catch {
        return match.torrentFile.trackers[0];
      }
    },
    [matchByPath],
  );

  const filtered = useMemo(() => {
    let items = untiedFiles;
    // Remove entries matched to active (non-stopped) loaded torrents
    if (filteredPaths) {
      items = items.filter((f) => !filteredPaths.has(f.path));
    }
    if (showFilter === 'matched' && matchResult) {
      items = items.filter((f) => matchByPath.has(f.path));
    } else if (showFilter === 'unmatched' && matchResult) {
      items = items.filter((f) => !matchByPath.has(f.path));
    }
    if (dirFilter !== 'all') {
      items = items.filter((f) => f.sourceDir === dirFilter);
    }
    if (search) {
      const q = search.toLowerCase();
      items = items.filter((f) => f.name.toLowerCase().includes(q) || f.path.toLowerCase().includes(q));
    }
    items = [...items].sort((a, b) => {
      let cmp = 0;
      switch (sortField) {
        case 'name':
          cmp = a.name.localeCompare(b.name);
          break;
        case 'size':
          cmp = a.size - b.size;
          break;
        case 'mtime':
          cmp = a.mtime - b.mtime;
          break;
        case 'sourceDir':
          cmp = a.sourceDir.localeCompare(b.sourceDir);
          break;
        case 'tracker':
          cmp = getTracker(a).localeCompare(getTracker(b));
          break;
      }
      return sortDir === 'asc' ? cmp : -cmp;
    });
    return items;
  }, [
    untiedFiles,
    search,
    sortField,
    sortDir,
    dirFilter,
    filteredPaths,
    showFilter,
    matchResult,
    matchByPath,
    getTracker,
  ]);

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

  const handleAddTorrent = useCallback(
    async (match: StocktakeMatch) => {
      setAddingPaths((prev) => new Set(prev).add(match.untiedPath));
      try {
        await axios.post(`${baseURI}api/stocktake/add-matched`, {
          torrentPath: match.torrentFile.torrentPath,
          destination: match.untiedPath,
        });
        setCompletedPaths((prev) => new Map(prev).set(match.untiedPath, 'added'));
        onTorrentAdded({
          name: match.torrentFile.infoName,
          size: match.torrentFile.totalSize,
          torrentFilePath: match.torrentFile.torrentPath,
          destination: match.untiedPath,
          addedAt: Date.now(),
          status: 'added',
        });
      } catch (e) {
        const msg = e instanceof Error ? e.message : 'Failed to add torrent';
        setCompletedPaths((prev) => new Map(prev).set(match.untiedPath, 'error'));
        onTorrentAdded({
          name: match.torrentFile.infoName,
          size: match.torrentFile.totalSize,
          torrentFilePath: match.torrentFile.torrentPath,
          destination: match.untiedPath,
          addedAt: Date.now(),
          status: 'error',
          error: msg,
        });
      } finally {
        setAddingPaths((prev) => {
          const next = new Set(prev);
          next.delete(match.untiedPath);
          return next;
        });
      }
    },
    [onTorrentAdded],
  );

  const handleCheckHash = useCallback(
    async (match: StocktakeMatch) => {
      setAddingPaths((prev) => new Set(prev).add(match.untiedPath));
      try {
        await axios.post(`${baseURI}api/torrents/check-hash`, {
          hashes: [match.torrentFile.infoHash],
        });
        setCompletedPaths((prev) => new Map(prev).set(match.untiedPath, 'checked'));
        onTorrentAdded({
          name: match.torrentFile.infoName,
          size: match.torrentFile.totalSize,
          torrentFilePath: match.torrentFile.torrentPath,
          destination: match.untiedPath,
          addedAt: Date.now(),
          status: 'checked',
        });
      } catch (e) {
        const msg = e instanceof Error ? e.message : 'Failed to check hash';
        setCompletedPaths((prev) => new Map(prev).set(match.untiedPath, 'error'));
        onTorrentAdded({
          name: match.torrentFile.infoName,
          size: match.torrentFile.totalSize,
          torrentFilePath: match.torrentFile.torrentPath,
          destination: match.untiedPath,
          addedAt: Date.now(),
          status: 'error',
          error: msg,
        });
      } finally {
        setAddingPaths((prev) => {
          const next = new Set(prev);
          next.delete(match.untiedPath);
          return next;
        });
      }
    },
    [onTorrentAdded],
  );

  const totalSize = filtered.reduce((acc, f) => acc + f.size, 0);
  const matchedEntries = matchResult ? filtered.filter((f) => matchByPath.has(f.path)) : [];
  const matchedCount = matchedEntries.length;
  const loadedCount = matchedEntries.filter((f) => matchByPath.get(f.path)?.alreadyLoaded).length;
  const newCount = matchedCount - loadedCount;

  return (
    <div className="stocktake__tab-content">
      <div className="stocktake__match-controls">
        <label className="stocktake__match-label">Match .torrent files</label>
        <div className="stocktake__match-row">
          <input
            className="stocktake__search"
            type="text"
            placeholder="/path/to/torrent/files…"
            value={torrentDir}
            onChange={(e) => onTorrentDirChange(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') onRunMatch();
            }}
          />
          <button
            type="button"
            className="stocktake__btn-match"
            disabled={isMatching || !torrentDir.trim()}
            onClick={onRunMatch}
          >
            {isMatching ? 'Scanning…' : 'Match'}
          </button>
        </div>
        {matchError && <div className="stocktake__match-error">{matchError}</div>}
        {matchResult && !matchError && (
          <div className="stocktake__match-summary-box">
            Found {matchResult.torrentFileCount} .torrent file{matchResult.torrentFileCount !== 1 ? 's' : ''} (
            {matchResult.parsedCount} parsed) · {matchResult.matches.length} matched to untied files
            {matchResult.matches.filter((m) => m.alreadyLoaded).length > 0 && (
              <span> ({matchResult.matches.filter((m) => m.alreadyLoaded).length} stopped, need hash check)</span>
            )}
            {(matchResult.filteredUntiedPaths?.length ?? 0) > 0 && (
              <span> · {matchResult.filteredUntiedPaths.length} removed (active in client)</span>
            )}
            {matchResult.parseError && <div className="stocktake__error-hint">⚠ {matchResult.parseError}</div>}
          </div>
        )}
      </div>
      <div className="stocktake__controls">
        <input
          className="stocktake__search"
          type="text"
          placeholder="Search files..."
          value={search}
          onChange={(e) => setSearch(e.target.value)}
        />
        <select className="stocktake__select" value={dirFilter} onChange={(e) => setDirFilter(e.target.value)}>
          <option value="all">All directories</option>
          {sourceDirs.map((d) => (
            <option key={d} value={d}>
              {d}
            </option>
          ))}
        </select>
        {matchResult && (
          <select
            className="stocktake__select"
            value={showFilter}
            onChange={(e) => setShowFilter(e.target.value as 'all' | 'matched' | 'unmatched')}
          >
            <option value="all">All files</option>
            <option value="matched">Matched only</option>
            <option value="unmatched">Unmatched only</option>
          </select>
        )}
      </div>
      <div className="stocktake__count">
        {filtered.length} untied file{filtered.length !== 1 ? 's' : ''} ({formatSize(totalSize)})
        {matchedCount > 0 && (
          <span className="stocktake__match-summary">
            {' '}
            · {matchedCount} matched ({loadedCount} loaded, {newCount} new)
          </span>
        )}
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
              <th onClick={() => handleSort('mtime')} className="stocktake__th-sortable">
                Modified{sortIndicator('mtime')}
              </th>
              <th onClick={() => handleSort('sourceDir')} className="stocktake__th-sortable">
                Directory{sortIndicator('sourceDir')}
              </th>
              {matchResult && (
                <th onClick={() => handleSort('tracker')} className="stocktake__th-sortable">
                  Tracker{sortIndicator('tracker')}
                </th>
              )}
              {matchResult && <th>Action</th>}
            </tr>
          </thead>
          <tbody>
            {filtered.map((f) => {
              const match = matchByPath.get(f.path);
              const isAdding = addingPaths.has(f.path);
              return (
                <tr
                  key={f.path}
                  className={
                    match ? (match.alreadyLoaded ? 'stocktake__row--matched-loaded' : 'stocktake__row--matched') : ''
                  }
                >
                  <td
                    className="stocktake__td-name"
                    title={match ? `Matched: ${match.torrentFile.torrentPath}` : f.path}
                  >
                    {f.isDirectory ? '📁 ' : '📄 '}
                    {f.name}
                  </td>
                  <td className="stocktake__table-right">{formatSize(f.size)}</td>
                  <td>{formatDate(f.mtime)}</td>
                  <td className="stocktake__td-dir">{f.sourceDir}</td>
                  {matchResult && <td className="stocktake__td-tracker">{getTracker(f) || ''}</td>}
                  {matchResult && (
                    <td>
                      {match &&
                        (() => {
                          const completed = completedPaths.get(f.path);
                          if (match.alreadyLoaded) {
                            return (
                              <button
                                type="button"
                                className={completed === 'error' ? 'stocktake__btn-add' : 'stocktake__btn-check'}
                                disabled={isAdding || !!completed}
                                onClick={() => handleCheckHash(match)}
                              >
                                {isAdding
                                  ? 'Checking…'
                                  : completed === 'checked'
                                  ? 'Checking'
                                  : completed === 'error'
                                  ? 'Failed'
                                  : 'Check Hash'}
                              </button>
                            );
                          }
                          return (
                            <button
                              type="button"
                              className={completed === 'error' ? 'stocktake__btn-check' : 'stocktake__btn-add'}
                              disabled={isAdding || !!completed}
                              onClick={() => handleAddTorrent(match)}
                            >
                              {isAdding
                                ? 'Adding…'
                                : completed === 'added'
                                ? 'Added'
                                : completed === 'error'
                                ? 'Failed'
                                : 'Add to Client'}
                            </button>
                          );
                        })()}
                    </td>
                  )}
                </tr>
              );
            })}
            {filtered.length === 0 && (
              <tr>
                <td colSpan={matchResult ? 7 : 4} className="stocktake__empty">
                  No untied files found.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
};

export default StocktakeUntied;
