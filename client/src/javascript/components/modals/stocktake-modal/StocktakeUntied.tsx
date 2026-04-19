import {FC, useMemo, useState} from 'react';

import type {StocktakeDiskEntry} from '@shared/types/Stocktake';

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

type SortField = 'name' | 'size' | 'mtime' | 'sourceDir';

interface StocktakeUntiedProps {
  untiedFiles: StocktakeDiskEntry[];
}

const StocktakeUntied: FC<StocktakeUntiedProps> = ({untiedFiles}: StocktakeUntiedProps) => {
  const [search, setSearch] = useState('');
  const [sortField, setSortField] = useState<SortField>('name');
  const [sortDir, setSortDir] = useState<'asc' | 'desc'>('asc');
  const [dirFilter, setDirFilter] = useState<string>('all');

  const sourceDirs = useMemo(() => {
    const dirs = new Set(untiedFiles.map((f) => f.sourceDir));
    return Array.from(dirs).sort();
  }, [untiedFiles]);

  const filtered = useMemo(() => {
    let items = untiedFiles;
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
      }
      return sortDir === 'asc' ? cmp : -cmp;
    });
    return items;
  }, [untiedFiles, search, sortField, sortDir, dirFilter]);

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

  const totalSize = filtered.reduce((acc, f) => acc + f.size, 0);

  return (
    <div className="stocktake__tab-content">
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
      </div>
      <div className="stocktake__count">
        {filtered.length} untied file{filtered.length !== 1 ? 's' : ''} ({formatSize(totalSize)})
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
            </tr>
          </thead>
          <tbody>
            {filtered.map((f) => (
              <tr key={f.path}>
                <td className="stocktake__td-name" title={f.path}>
                  {f.isDirectory ? '📁 ' : '📄 '}
                  {f.name}
                </td>
                <td className="stocktake__table-right">{formatSize(f.size)}</td>
                <td>{formatDate(f.mtime)}</td>
                <td className="stocktake__td-dir">{f.sourceDir}</td>
              </tr>
            ))}
            {filtered.length === 0 && (
              <tr>
                <td colSpan={4} className="stocktake__empty">
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
