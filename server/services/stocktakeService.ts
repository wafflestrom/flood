import {spawn} from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';

import type {
  StocktakeDirBreakdown,
  StocktakeDiskEntry,
  StocktakeResult,
  StocktakeSummary,
  StocktakeTorrentMatch,
} from '@shared/types/Stocktake';
import type {TorrentProperties} from '@shared/types/Torrent';

import config from '../../config';
import type {ServiceInstances} from './index';

interface DiskFile {
  filePath: string;
  size: number;
  mtime: number;
  isDirectory: boolean;
}

const DU_CONCURRENCY = 8;
const DU_TIMEOUT_MS = 2000;

function normalisePath(p: string): string {
  return path.normalize(p).replace(/\/+$/, '');
}

function findTopLevelEntry(normPath: string, normRoots: string[]): string | null {
  let bestRoot: string | null = null;
  let bestEntry: string | null = null;

  for (const normRoot of normRoots) {
    if (!normPath.startsWith(normRoot + '/') && normPath !== normRoot) {
      continue;
    }
    const rel = path.relative(normRoot, normPath);
    const topComponent = rel.split(path.sep)[0];
    if (topComponent === '.' || topComponent === '') {
      continue;
    }
    if (!bestRoot || normRoot.length > bestRoot.length) {
      bestRoot = normRoot;
      bestEntry = path.join(normRoot, topComponent);
    }
  }
  return bestEntry;
}

async function getTopLevelEntries(root: string, skipPaths: Set<string>): Promise<DiskFile[]> {
  const entries: DiskFile[] = [];
  const rootPath = normalisePath(root);

  try {
    const dirents = await fs.promises.readdir(rootPath, {withFileTypes: true});
    const statPromises = dirents.map(async (dirent) => {
      const fullPath = path.join(rootPath, dirent.name);
      if (skipPaths.has(normalisePath(fullPath))) return null;
      try {
        const stat = await fs.promises.stat(fullPath);
        const isDir = dirent.isDirectory() || (dirent.isSymbolicLink() && stat.isDirectory());
        return {
          filePath: fullPath,
          size: isDir ? 0 : stat.size,
          mtime: stat.mtimeMs / 1000,
          isDirectory: isDir,
        } as DiskFile;
      } catch {
        return null;
      }
    });
    const results = await Promise.all(statPromises);
    for (const r of results) {
      if (r) entries.push(r);
    }
  } catch {
    // skip directories we can't read
  }

  return entries;
}

function parseDuLine(line: string, isLinux: boolean): [string, number] | null {
  const tab = line.indexOf('\t');
  if (tab === -1) return null;
  const size = parseInt(line.substring(0, tab), 10);
  const dirPath = line.substring(tab + 1);
  if (Number.isNaN(size)) return null;
  return [dirPath, isLinux ? size : size * 1024];
}

// Parallel du with global time budget: spawns up to DU_CONCURRENCY
// processes and kills remaining when DU_TIMEOUT_MS is reached.
async function getDirectorySizes(dirs: string[]): Promise<Map<string, number>> {
  if (dirs.length === 0) return new Map();

  const result = new Map<string, number>();
  const isLinux = process.platform === 'linux';
  const flag = isLinux ? '-sb' : '-sk';

  const queue = [...dirs];
  const active = new Set<ReturnType<typeof spawn>>();
  let timedOut = false;

  const deadline = Date.now() + DU_TIMEOUT_MS;

  const runOne = (dir: string): Promise<void> =>
    new Promise((resolve) => {
      if (timedOut) {
        resolve();
        return;
      }

      const remaining = deadline - Date.now();
      if (remaining <= 0) {
        timedOut = true;
        resolve();
        return;
      }

      const proc = spawn('du', [flag, dir], {stdio: ['ignore', 'pipe', 'ignore']});
      active.add(proc);

      let stdout = '';
      proc.stdout.on('data', (chunk: Buffer) => {
        stdout += chunk.toString();
      });

      const timer = setTimeout(() => {
        proc.kill('SIGTERM');
      }, remaining);

      proc.on('close', () => {
        clearTimeout(timer);
        active.delete(proc);
        for (const line of stdout.trim().split('\n')) {
          const parsed = parseDuLine(line, isLinux);
          if (parsed) result.set(parsed[0], parsed[1]);
        }
        resolve();
      });
    });

  // Process queue with bounded concurrency
  const workers: Promise<void>[] = [];
  for (let i = 0; i < DU_CONCURRENCY; i++) {
    workers.push(
      (async () => {
        while (!timedOut) {
          const dir = queue.shift();
          if (!dir) break;
          await runOne(dir);
        }
      })(),
    );
  }

  // Global timeout: kill all active processes
  const globalTimer = setTimeout(() => {
    timedOut = true;
    for (const proc of active) {
      proc.kill('SIGTERM');
    }
  }, DU_TIMEOUT_MS);

  await Promise.all(workers);
  clearTimeout(globalTimer);

  return result;
}

function getTorrentStatus(torrent: TorrentProperties): string {
  if (torrent.message && torrent.message.length > 0) {
    return 'error';
  }
  if (torrent.status.includes('checking')) {
    return 'hashing';
  }
  if (torrent.percentComplete < 100) {
    return 'downloading';
  }
  if (torrent.status.includes('seeding') || torrent.status.includes('active')) {
    return 'seeding';
  }
  if (torrent.status.includes('stopped') || torrent.status.includes('inactive')) {
    return 'stopped';
  }
  return 'stopped';
}

function formatSize(bytes: number): string {
  if (bytes === 0) return '0.00 B';
  const units = ['B', 'KB', 'MB', 'GB', 'TB', 'PB'];
  const i = Math.floor(Math.log(bytes) / Math.log(1024));
  return (bytes / Math.pow(1024, i)).toFixed(2) + ' ' + units[i];
}

let cachedResult: StocktakeResult | null = null;

export async function getStocktakeResult(): Promise<StocktakeResult | null> {
  return cachedResult;
}

function deriveContentRoots(torrents: TorrentProperties[]): string[] {
  const dirCounts = new Map<string, number>();
  for (const t of torrents) {
    const bp = t.basePath || t.directory;
    if (bp && bp !== '/' && bp.length > 1) {
      const dir = normalisePath(path.dirname(bp));
      dirCounts.set(dir, (dirCounts.get(dir) || 0) + 1);
    }
  }

  const MIN_TORRENTS = 5;
  const significant = [...dirCounts.entries()]
    .filter(([, count]) => count >= MIN_TORRENTS)
    .map(([dir]) => dir)
    .sort();

  return significant.length > 0 ? significant : [...dirCounts.keys()].sort();
}

export async function runStocktakeScan(services: ServiceInstances): Promise<StocktakeResult> {
  const startTime = Date.now();

  // O1: Use polled torrent list cache instead of forcing an SCGI round-trip.
  // The polling system refreshes every 2s when a user is connected.
  const torrentList = services.torrentService.getTorrentList();
  const torrents: TorrentProperties[] = Object.values(torrentList);

  const explicitDirs = config.stocktakeDirs ?? [];
  const scanDirs = explicitDirs.length > 0 ? explicitDirs : deriveContentRoots(torrents);

  if (scanDirs.length === 0) {
    throw new Error('No scan directories could be determined. No torrents have base paths set.');
  }

  const scanDirNorms = new Set(scanDirs.map(normalisePath));

  // O2: Scan all dirs in parallel instead of sequentially
  const allDiskFiles: Map<string, DiskFile[]> = new Map();
  await Promise.all(
    scanDirs.map(async (dir) => {
      const entries = await getTopLevelEntries(dir, scanDirNorms);
      allDiskFiles.set(dir, entries);
    }),
  );

  // O4: Pre-compute normalised roots (passed directly to findTopLevelEntry)
  const normalisedRoots = scanDirs.map(normalisePath);

  // Build disk entry lookup: normalised path -> DiskEntry
  // Also build name-based lookup for fallback matching (case-insensitive)
  const allDisk: StocktakeDiskEntry[] = [];
  const pathToDisk: Map<string, StocktakeDiskEntry> = new Map();
  const nameToDisk: Map<string, StocktakeDiskEntry[]> = new Map();

  for (const [sourceDir, files] of allDiskFiles) {
    for (const f of files) {
      const entry: StocktakeDiskEntry = {
        path: f.filePath,
        name: path.basename(f.filePath),
        size: f.size,
        mtime: f.mtime,
        isDirectory: f.isDirectory,
        sourceDir,
        matchedTorrentHashes: [],
      };
      allDisk.push(entry);
      pathToDisk.set(normalisePath(f.filePath), entry);

      const lowerName = entry.name.toLowerCase();
      const existing = nameToDisk.get(lowerName);
      if (existing) {
        existing.push(entry);
      } else {
        nameToDisk.set(lowerName, [entry]);
      }
    }
  }

  // O4: Pre-normalise torrent candidate paths for matching
  const allTorrentMatches: StocktakeTorrentMatch[] = [];

  for (const t of torrents) {
    let diskEntryPath: string | null = null;
    let inScannedDir = false;

    const candidatePaths = [t.basePath, path.join(t.directory, t.name), t.directory].filter(Boolean) as string[];
    for (const candidatePath of candidatePaths) {
      const topEntryPath = findTopLevelEntry(normalisePath(candidatePath), normalisedRoots);
      if (topEntryPath) {
        inScannedDir = true;
        const diskEntry = pathToDisk.get(topEntryPath);
        if (diskEntry) {
          diskEntryPath = diskEntry.path;
          diskEntry.matchedTorrentHashes.push(t.hash);
          break;
        }
      }
    }

    allTorrentMatches.push({
      hash: t.hash,
      name: t.name,
      sizeBytes: t.sizeBytes,
      basePath: t.basePath || t.directory,
      directory: t.directory,
      status: 'unknown',
      trackerURIs: t.trackerURIs ?? [],
      tags: t.tags ?? [],
      percentComplete: t.percentComplete,
      ratio: t.ratio,
      dateAdded: t.dateAdded,
      diskEntryPath,
      filesOnDisk: !!diskEntryPath,
      inScannedDir,
      matchType: diskEntryPath ? 'path' : null,
      suggestedPath: null,
    });
  }

  // Name-based fallback: for unmatched torrents, search all disk entries by name.
  // This catches torrents whose files exist on disk but at a different path
  // (e.g. torrent points to /data/old/Ubuntu but files are at /data/new/Ubuntu).
  // Many-to-one is valid — multiple torrents (cross-seeding) can match one disk entry.
  for (const m of allTorrentMatches) {
    if (m.diskEntryPath) continue;

    const candidates = nameToDisk.get(m.name.toLowerCase());
    if (!candidates || candidates.length === 0) continue;

    // For files: prefer exact size match, then accept any shape-compatible entry.
    // For directories: can't compare sizes (not computed yet), accept shape match.
    let bestMatch: StocktakeDiskEntry | null = null;

    for (const candidate of candidates) {
      // Shape check: files match files, directories match directories
      const torrentIsDir = m.basePath !== m.directory || (m.basePath === m.directory && candidate.isDirectory);
      if (candidate.isDirectory !== torrentIsDir) {
        // Allow match if candidate is a directory (multi-file torrent could be stored
        // in the directory name matching the torrent name)
        if (!candidate.isDirectory) continue;
      }

      if (!candidate.isDirectory && candidate.size > 0 && m.sizeBytes > 0) {
        // For files: require size within ±10%
        const ratio = candidate.size / m.sizeBytes;
        if (ratio >= 0.9 && ratio <= 1.1) {
          bestMatch = candidate;
          break;
        }
      } else {
        // Directory or unknown size: accept the match
        if (!bestMatch) bestMatch = candidate;
      }
    }

    if (bestMatch) {
      bestMatch.matchedTorrentHashes.push(m.hash);
      m.diskEntryPath = bestMatch.path;
      m.filesOnDisk = true;
      m.inScannedDir = true;
      m.matchType = 'name';
      // suggestedPath = the parent directory where the files were actually found
      m.suggestedPath = bestMatch.sourceDir;
    }
  }

  // Batch existence check for torrents not matched to a scanned disk entry
  const needsCheck = allTorrentMatches.filter((m) => !m.diskEntryPath);
  const parentDirs = new Set<string>();
  for (const m of needsCheck) {
    const bp = m.basePath;
    if (bp) {
      parentDirs.add(path.dirname(bp));
      parentDirs.add(bp);
    }
  }

  const existingPaths = new Set<string>();
  await Promise.all(
    [...parentDirs].map(async (dir) => {
      try {
        const entries = await fs.promises.readdir(dir);
        for (const entry of entries) {
          existingPaths.add(path.join(dir, entry));
        }
        existingPaths.add(dir);
      } catch {
        // directory doesn't exist or not accessible
      }
    }),
  );

  for (const m of needsCheck) {
    if (m.basePath && existingPaths.has(m.basePath)) {
      m.filesOnDisk = true;
    }
  }

  // Set final status and compute tied directory sizes from torrent metadata
  const torrentByHash = new Map<string, TorrentProperties>(torrents.map((t) => [t.hash, t]));

  // O5: Single-pass status counting
  let seedingCount = 0;
  let stoppedCount = 0;
  let downloadingCount = 0;
  let errorCount = 0;
  let outsideCount = 0;
  let relocatedCount = 0;
  const orphanedTorrents: StocktakeTorrentMatch[] = [];

  for (const m of allTorrentMatches) {
    const t = torrentByHash.get(m.hash)!;
    if (m.matchType === 'name') {
      // Files found by name at a different location — surface as relocated
      m.status = 'relocated';
      relocatedCount++;
    } else if (m.filesOnDisk) {
      m.status = getTorrentStatus(t);
    } else if (t.percentComplete >= 100) {
      m.status = 'orphaned';
    } else if (t.status.includes('stopped') || t.status.includes('inactive')) {
      m.status = 'stopped';
    } else {
      m.status = 'downloading';
    }

    switch (m.status) {
      case 'seeding':
        seedingCount++;
        break;
      case 'stopped':
        stoppedCount++;
        break;
      case 'downloading':
        downloadingCount++;
        break;
      case 'error':
        errorCount++;
        break;
      case 'orphaned':
        orphanedTorrents.push(m);
        break;
    }
    if (!m.inScannedDir) outsideCount++;
  }

  // Compute tied directory sizes from torrent metadata (avoids recursive stat)
  for (const entry of allDisk) {
    if (entry.isDirectory && entry.size === 0 && entry.matchedTorrentHashes.length > 0) {
      entry.size = entry.matchedTorrentHashes.reduce((acc, hash) => {
        const t = torrentByHash.get(hash);
        return acc + (t?.sizeBytes ?? 0);
      }, 0);
    }
  }

  // Classify untied files
  let untiedFiles = allDisk.filter((e) => e.matchedTorrentHashes.length === 0);

  // O3: Parallel du with 2s time budget (benchmarked as fastest approach)
  const untiedDirs = untiedFiles.filter((e) => e.isDirectory && e.size === 0);
  if (untiedDirs.length > 0) {
    const sizeMap = await getDirectorySizes(untiedDirs.map((e) => e.path));
    for (const entry of untiedDirs) {
      entry.size = sizeMap.get(entry.path) ?? 0;
    }
  }

  // Drop zero-size directories (empty or unreadable)
  untiedFiles = untiedFiles.filter((e) => !e.isDirectory || e.size > 0);

  // O5: Single-pass disk size aggregation + pre-grouped dir breakdown
  let totalDiskSize = 0;
  let tiedDiskSize = 0;
  const dirBreakdownMap = new Map<
    string,
    {
      totalCount: number;
      tiedCount: number;
      untiedCount: number;
      totalSize: number;
      tiedSize: number;
      untiedSize: number;
    }
  >();

  for (const dir of scanDirs) {
    dirBreakdownMap.set(dir, {totalCount: 0, tiedCount: 0, untiedCount: 0, totalSize: 0, tiedSize: 0, untiedSize: 0});
  }

  for (const e of allDisk) {
    totalDiskSize += e.size;
    const isTied = e.matchedTorrentHashes.length > 0;
    if (isTied) tiedDiskSize += e.size;

    const bd = dirBreakdownMap.get(e.sourceDir);
    if (bd) {
      bd.totalCount++;
      bd.totalSize += e.size;
      if (isTied) {
        bd.tiedCount++;
        bd.tiedSize += e.size;
      } else {
        bd.untiedCount++;
        bd.untiedSize += e.size;
      }
    }
  }

  const untiedDiskSize = untiedFiles.reduce((acc, e) => acc + e.size, 0);
  const torrentTotalSize = torrents.reduce((acc, t) => acc + t.sizeBytes, 0);

  const dirBreakdown: StocktakeDirBreakdown[] = scanDirs.map((dir) => {
    const bd = dirBreakdownMap.get(dir)!;
    return {sourceDir: dir, ...bd};
  });

  const summary: StocktakeSummary = {
    scanTime: (Date.now() - startTime) / 1000,
    totalTorrents: torrents.length,
    totalDiskEntries: allDisk.length,
    totalDiskSize,
    tiedDiskSize,
    untiedDiskSize,
    torrentTotalSize,
    untiedCount: untiedFiles.length,
    orphanedCount: orphanedTorrents.length,
    seedingCount,
    stoppedCount,
    downloadingCount,
    errorCount,
    outsideCount,
    relocatedCount,
  };

  const relocatedTorrents = allTorrentMatches.filter((m) => m.status === 'relocated');

  const result: StocktakeResult = {
    summary,
    untiedFiles,
    orphanedTorrents,
    relocatedTorrents,
    allTorrents: allTorrentMatches,
    allDiskEntries: allDisk,
    dirBreakdown,
    scanDirs,
    generatedAt: Date.now(),
  };

  cachedResult = result;
  return result;
}

export {formatSize};
