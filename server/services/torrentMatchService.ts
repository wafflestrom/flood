import fs from 'node:fs';
import path from 'node:path';

import type {StocktakeDiskEntry, StocktakeMatch, StocktakeMatchResult, TorrentFileInfo} from '@shared/types/Stocktake';
import bencode from 'bencode';

import {getStocktakeResult} from './stocktakeService';

const MAX_TORRENT_FILES = 10_000;
const PARSE_CONCURRENCY = 50;

async function walkForTorrentFiles(dir: string): Promise<string[]> {
  const results: string[] = [];

  async function walk(currentDir: string): Promise<void> {
    if (results.length >= MAX_TORRENT_FILES) return;

    let entries: fs.Dirent[];
    try {
      entries = await fs.promises.readdir(currentDir, {withFileTypes: true});
    } catch {
      return;
    }

    for (const entry of entries) {
      if (results.length >= MAX_TORRENT_FILES) break;
      const fullPath = path.join(currentDir, entry.name);

      // Only follow real directories, skip symlinks to avoid escapes and cycles
      if (entry.isDirectory()) {
        await walk(fullPath);
      } else if (!entry.isSymbolicLink() && entry.name.endsWith('.torrent')) {
        results.push(fullPath);
      }
    }
  }

  await walk(dir);
  return results;
}

function decodeInfoName(info: {name: Buffer; 'name.utf-8'?: Buffer}): string {
  // Prefer BEP 47 name.utf-8 when available
  const nameUtf8 = info['name.utf-8'];
  if (nameUtf8 && Buffer.isBuffer(nameUtf8)) {
    const decoded = nameUtf8.toString('utf8');
    if (!decoded.includes('\uFFFD')) return decoded;
  }

  try {
    const utf8 = info.name.toString('utf8');
    if (!utf8.includes('\uFFFD')) return utf8;
  } catch {
    // fall through
  }
  return info.name.toString('latin1');
}

function getContentSize(info: {length?: number; files?: Array<{length: number}>}): number {
  if (info.length != null) return info.length;
  if (info.files != null) {
    return info.files.reduce((acc, f) => acc + f.length, 0);
  }
  return 0;
}

function extractTrackers(torrentData: {announce?: Buffer; 'announce-list'?: Array<Array<Buffer>>}): string[] {
  const trackers: string[] = [];
  if (torrentData['announce-list']) {
    for (const tier of torrentData['announce-list']) {
      for (const url of tier) {
        trackers.push(url.toString('utf8'));
      }
    }
  } else if (torrentData.announce) {
    trackers.push(torrentData.announce.toString('utf8'));
  }
  return trackers;
}

export async function parseTorrentFile(filePath: string): Promise<TorrentFileInfo | null> {
  try {
    const data = await fs.promises.readFile(filePath);
    const decoded = bencode.decode(data);

    if (!decoded?.info?.name) return null;

    const info = decoded.info;
    const infoName = decodeInfoName(info);
    const totalSize = getContentSize(info);
    const isSingleFile = info.length != null;
    const fileCount = isSingleFile ? 1 : info.files?.length ?? 0;
    const trackers = extractTrackers(decoded);

    return {
      torrentPath: filePath,
      infoName,
      totalSize,
      fileCount,
      trackers,
      isSingleFile,
    };
  } catch {
    return null;
  }
}

function scoreCandidateMatch(tf: TorrentFileInfo, candidate: StocktakeDiskEntry): number {
  let score = 0;

  // Shape match: directory torrent ↔ directory entry, single-file ↔ file
  const shapeMatch = candidate.isDirectory === !tf.isSingleFile;
  if (shapeMatch) score += 10;

  // Size match (only meaningful when both are non-zero)
  if (candidate.size > 0 && tf.totalSize > 0) {
    if (candidate.size === tf.totalSize) {
      score += 5; // exact byte match
    } else {
      const ratio = candidate.size / tf.totalSize;
      if (ratio > 0.9 && ratio < 1.1) {
        score += 3; // close match
      }
    }
  }

  return score;
}

export function matchTorrentsToUntied(
  torrentFiles: TorrentFileInfo[],
  untiedFiles: StocktakeDiskEntry[],
): {matches: StocktakeMatch[]; unmatchedTorrents: TorrentFileInfo[]} {
  const untiedByName = new Map<string, StocktakeDiskEntry[]>();
  for (const entry of untiedFiles) {
    const key = entry.name.toLowerCase();
    const existing = untiedByName.get(key) ?? [];
    existing.push(entry);
    untiedByName.set(key, existing);
  }

  const matches: StocktakeMatch[] = [];
  const matchedUntiedPaths = new Set<string>();
  const unmatchedTorrents: TorrentFileInfo[] = [];

  for (const tf of torrentFiles) {
    const key = tf.infoName.toLowerCase();
    const candidates = untiedByName.get(key);
    if (!candidates || candidates.length === 0) {
      unmatchedTorrents.push(tf);
      continue;
    }

    // Score all unused candidates and pick the best
    let bestCandidate: StocktakeDiskEntry | null = null;
    let bestScore = -1;

    for (const candidate of candidates) {
      if (matchedUntiedPaths.has(candidate.path)) continue;
      const score = scoreCandidateMatch(tf, candidate);
      if (score > bestScore) {
        bestScore = score;
        bestCandidate = candidate;
      }
    }

    if (bestCandidate) {
      const sizeMatch = bestCandidate.size > 0 && tf.totalSize > 0 && bestCandidate.size === tf.totalSize;
      const shapeMatch = bestCandidate.isDirectory === !tf.isSingleFile;
      const confidence = sizeMatch && shapeMatch ? 'exact' : 'name-only';

      matches.push({
        untiedPath: bestCandidate.path,
        untiedName: bestCandidate.name,
        torrentFile: tf,
        confidence,
      });
      matchedUntiedPaths.add(bestCandidate.path);
    } else {
      unmatchedTorrents.push(tf);
    }
  }

  return {matches, unmatchedTorrents};
}

async function parseWithBoundedConcurrency(
  paths: string[],
): Promise<{parsed: TorrentFileInfo[]; firstError: string | null}> {
  const parsed: TorrentFileInfo[] = [];
  let firstError: string | null = null;
  for (let i = 0; i < paths.length; i += PARSE_CONCURRENCY) {
    const batch = paths.slice(i, i + PARSE_CONCURRENCY);
    const results = await Promise.all(
      batch.map(async (p) => {
        try {
          return await parseTorrentFile(p);
        } catch (e) {
          if (!firstError) firstError = `${p}: ${e instanceof Error ? e.message : String(e)}`;
          return null;
        }
      }),
    );
    for (const result of results) {
      if (result) parsed.push(result);
    }
  }
  return {parsed, firstError};
}

export async function runTorrentMatch(torrentDir: string): Promise<StocktakeMatchResult> {
  const stocktakeResult = await getStocktakeResult();
  if (!stocktakeResult) {
    throw new Error('No stocktake scan available. Run a scan first.');
  }

  const torrentPaths = await walkForTorrentFiles(torrentDir);
  const {parsed: torrentFiles, firstError} = await parseWithBoundedConcurrency(torrentPaths);

  const {matches, unmatchedTorrents} = matchTorrentsToUntied(torrentFiles, stocktakeResult.untiedFiles);

  // Surface a diagnostic hint when all parsing failed
  let parseError: string | undefined;
  if (torrentPaths.length > 0 && torrentFiles.length === 0) {
    parseError =
      firstError ??
      'All .torrent files failed to parse. Check that the flood server process can read them (file permissions).';
  }

  return {
    torrentDir,
    torrentFileCount: torrentPaths.length,
    parsedCount: torrentFiles.length,
    matches,
    unmatchedTorrents,
    parseError,
  };
}
