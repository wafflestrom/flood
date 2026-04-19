import {execFile} from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import {promisify} from 'node:util';

import type {TorrentProperties} from '@shared/types/Torrent';
import type {
  StocktakeDirBreakdown,
  StocktakeDiskEntry,
  StocktakeResult,
  StocktakeSummary,
  StocktakeTorrentMatch,
} from '@shared/types/Stocktake';

import config from '../../config';
import type {ServiceInstances} from '../index';

interface DiskFile {
  filePath: string;
  size: number;
  mtime: number;
  isDirectory: boolean;
}

function normalisePath(p: string): string {
  return path.normalize(p).replace(/\/+$/, '');
}

function findTopLevelEntry(torrentPath: string, contentRoots: string[]): string | null {
  const normPath = normalisePath(torrentPath);
  let bestRoot: string | null = null;
  let bestEntry: string | null = null;

  for (const root of contentRoots) {
    const normRoot = normalisePath(root);
    if (!normPath.startsWith(normRoot + '/') && normPath !== normRoot) {
      continue;
    }
    const rel = path.relative(normRoot, normPath);
    const topComponent = rel.split(path.sep)[0];
    if (topComponent === '.' || topComponent === '') {
      continue;
    }
    // Prefer the most specific (longest) matching root
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

async function getDirectorySizes(dirs: string[]): Promise<Map<string, number>> {
  if (dirs.length === 0) return new Map();
  const result = new Map<string, number>();
  const execFileAsync = promisify(execFile);
  const isLinux = process.platform === 'linux';
  const args = isLinux ? ['-sb', ...dirs] : ['-sk', ...dirs];
  let stdout = '';
  try {
    const res = await execFileAsync('du', args, {maxBuffer: 10 * 1024 * 1024});
    stdout = res.stdout;
  } catch (e: unknown) {
    // du exits non-zero on permission errors but still produces partial output
    if (e && typeof e === 'object' && 'stdout' in e && typeof (e as {stdout: unknown}).stdout === 'string') {
      stdout = (e as {stdout: string}).stdout;
    }
  }
  if (!stdout) return result;
  for (const line of stdout.trim().split('\n')) {
    const tab = line.indexOf('\t');
    if (tab === -1) continue;
    const size = parseInt(line.substring(0, tab), 10);
    const dirPath = line.substring(tab + 1);
    result.set(dirPath, isLinux ? size : size * 1024);
  }
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

  // Keep directories that directly contain >= 5 torrents
  const MIN_TORRENTS = 5;
  const significant = [...dirCounts.entries()]
    .filter(([, count]) => count >= MIN_TORRENTS)
    .map(([dir]) => dir)
    .sort();

  return significant.length > 0 ? significant : [...dirCounts.keys()].sort();
}

export async function runStocktakeScan(services: ServiceInstances): Promise<StocktakeResult> {
  const startTime = Date.now();

  // Force refresh torrent list from rtorrent
  await services.torrentService.fetchTorrentList();
  const torrentList = services.torrentService.getTorrentList();
  const torrents = Object.values(torrentList);

  // Use CLI dirs if provided, otherwise auto-detect from torrent base paths
  const explicitDirs = config.stocktakeDirs ?? [];
  const scanDirs = explicitDirs.length > 0 ? explicitDirs : deriveContentRoots(torrents);

  if (scanDirs.length === 0) {
    throw new Error('No scan directories could be determined. No torrents have base paths set.');
  }

  // Build set of scan dirs to skip when scanning parent dirs
  const scanDirNorms = new Set(scanDirs.map(normalisePath));

  // Scan all configured directories for top-level entries
  const allDiskFiles: Map<string, DiskFile[]> = new Map();
  for (const dir of scanDirs) {
    const entries = await getTopLevelEntries(dir, scanDirNorms);
    allDiskFiles.set(dir, entries);
  }

  const normalisedRoots = scanDirs.map(normalisePath);

  // Build disk entry lookup: normalised path -> DiskEntry
  const allDisk: StocktakeDiskEntry[] = [];
  const pathToDisk: Map<string, StocktakeDiskEntry> = new Map();

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
    }
  }

  // Match each torrent to a disk entry
  const allTorrentMatches: StocktakeTorrentMatch[] = [];

  for (const t of torrents) {
    let diskEntryPath: string | null = null;
    let inScannedDir = false;
    let filesOnDisk = false;

    // Try basePath, then directory/name (reliable for single-file), then directory alone
    const candidatePaths = [t.basePath, path.join(t.directory, t.name), t.directory].filter(Boolean) as string[];
    for (const candidatePath of candidatePaths) {
      const topEntryPath = findTopLevelEntry(candidatePath, normalisedRoots);
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
      percentComplete: t.percentComplete,
      ratio: t.ratio,
      dateAdded: t.dateAdded,
      diskEntryPath,
      filesOnDisk: !!diskEntryPath,
      inScannedDir,
    });
  }

  // Batch existence check: readdir unique parent dirs instead of per-torrent fs.access
  const needsCheck = allTorrentMatches.filter((m) => !m.diskEntryPath);
  const parentDirs = new Set<string>();
  for (const m of needsCheck) {
    const bp = m.basePath;
    if (bp) {
      parentDirs.add(path.dirname(bp));
      parentDirs.add(bp); // basePath may itself be a directory
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
        existingPaths.add(dir); // dir itself exists
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

  // Set final status
  const torrentByHash = new Map(torrents.map((t) => [t.hash, t]));
  for (const m of allTorrentMatches) {
    const t = torrentByHash.get(m.hash)!;
    m.status = m.filesOnDisk ? getTorrentStatus(t) : t.percentComplete < 100 ? 'downloading' : 'orphaned';
  }

  // Compute directory sizes from matched torrent data (avoids slow recursive stat)
  for (const entry of allDisk) {
    if (entry.isDirectory && entry.size === 0 && entry.matchedTorrentHashes.length > 0) {
      entry.size = entry.matchedTorrentHashes.reduce((acc, hash) => {
        const t = torrentByHash.get(hash);
        return acc + (t?.sizeBytes ?? 0);
      }, 0);
    }
  }

  // Classify
  let untiedFiles = allDisk.filter((e) => e.matchedTorrentHashes.length === 0);

  // Compute sizes for untied directories via single `du` subprocess
  const untiedDirs = untiedFiles.filter((e) => e.isDirectory && e.size === 0);
  if (untiedDirs.length > 0) {
    const sizeMap = await getDirectorySizes(untiedDirs.map((e) => e.path));
    for (const entry of untiedDirs) {
      entry.size = sizeMap.get(entry.path) ?? 0;
    }
  }

  // Drop zero-size directories (empty or unreadable)
  untiedFiles = untiedFiles.filter((e) => !e.isDirectory || e.size > 0);

  const orphanedTorrents = allTorrentMatches.filter((m) => m.status === 'orphaned');

  const seedingCount = allTorrentMatches.filter((m) => m.status === 'seeding').length;
  const stoppedCount = allTorrentMatches.filter((m) => m.status === 'stopped').length;
  const downloadingCount = allTorrentMatches.filter((m) => m.status === 'downloading').length;
  const errorCount = allTorrentMatches.filter((m) => m.status === 'error').length;
  const outsideCount = allTorrentMatches.filter((m) => !m.inScannedDir).length;

  const totalDiskSize = allDisk.reduce((acc, e) => acc + e.size, 0);
  const tiedDiskSize = allDisk.filter((e) => e.matchedTorrentHashes.length > 0).reduce((acc, e) => acc + e.size, 0);
  const untiedDiskSize = untiedFiles.reduce((acc, e) => acc + e.size, 0);
  const torrentTotalSize = torrents.reduce((acc, t) => acc + t.sizeBytes, 0);

  // Directory breakdown
  const dirBreakdown: StocktakeDirBreakdown[] = scanDirs.map((dir) => {
    const entriesInDir = allDisk.filter((e) => e.sourceDir === dir);
    const tied = entriesInDir.filter((e) => e.matchedTorrentHashes.length > 0);
    const untied = entriesInDir.filter((e) => e.matchedTorrentHashes.length === 0);
    return {
      sourceDir: dir,
      totalCount: entriesInDir.length,
      tiedCount: tied.length,
      untiedCount: untied.length,
      totalSize: entriesInDir.reduce((acc, e) => acc + e.size, 0),
      tiedSize: tied.reduce((acc, e) => acc + e.size, 0),
      untiedSize: untied.reduce((acc, e) => acc + e.size, 0),
    };
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
  };

  const result: StocktakeResult = {
    summary,
    untiedFiles,
    orphanedTorrents,
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
