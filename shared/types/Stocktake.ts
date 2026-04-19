export interface StocktakeDiskEntry {
  path: string;
  name: string;
  size: number;
  mtime: number;
  isDirectory: boolean;
  sourceDir: string;
  matchedTorrentHashes: string[];
}

export interface StocktakeTorrentMatch {
  hash: string;
  name: string;
  sizeBytes: number;
  basePath: string;
  directory: string;
  status: string;
  trackerURIs: string[];
  percentComplete: number;
  ratio: number;
  dateAdded: number;
  diskEntryPath: string | null;
  filesOnDisk: boolean;
  inScannedDir: boolean;
}

export interface StocktakeDirBreakdown {
  sourceDir: string;
  totalCount: number;
  tiedCount: number;
  untiedCount: number;
  totalSize: number;
  tiedSize: number;
  untiedSize: number;
}

export interface StocktakeSummary {
  scanTime: number;
  totalTorrents: number;
  totalDiskEntries: number;
  totalDiskSize: number;
  tiedDiskSize: number;
  untiedDiskSize: number;
  torrentTotalSize: number;
  untiedCount: number;
  orphanedCount: number;
  seedingCount: number;
  stoppedCount: number;
  downloadingCount: number;
  errorCount: number;
  outsideCount: number;
}

export interface StocktakeResult {
  summary: StocktakeSummary;
  untiedFiles: StocktakeDiskEntry[];
  orphanedTorrents: StocktakeTorrentMatch[];
  allTorrents: StocktakeTorrentMatch[];
  allDiskEntries: StocktakeDiskEntry[];
  dirBreakdown: StocktakeDirBreakdown[];
  scanDirs: string[];
  generatedAt: number;
}
