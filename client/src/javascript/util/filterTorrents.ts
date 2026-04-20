import type {TorrentProperties} from '@shared/types/Torrent';
import type {TorrentStatus} from '@shared/constants/torrentStatusMap';

interface LocationFilter {
  type: 'location';
  filter: string[];
  excludeFilter?: string[];
}

interface StatusFilter {
  type: 'status';
  filter: TorrentStatus[];
  excludeFilter?: TorrentStatus[];
}

interface TrackerFilter {
  type: 'tracker';
  filter: string[];
  excludeFilter?: string[];
}

interface TagFilter {
  type: 'tag';
  filter: string[];
  excludeFilter?: string[];
}

function matchesLocation(torrent: TorrentProperties, directories: string[]): boolean {
  return directories.some((directory) => torrent.directory.startsWith(directory));
}

function matchesStatus(torrent: TorrentProperties, statuses: TorrentStatus[]): boolean {
  return torrent.status.some((status) => statuses.includes(status));
}

function matchesTracker(torrent: TorrentProperties, trackers: string[]): boolean {
  return torrent.trackerURIs.some((uri) => {
    let domain = uri;
    try {
      if (uri.includes('://')) {
        const url = new URL(uri);
        domain = url.hostname;
      } else {
        domain = uri.split('/')[0].split(':')[0];
      }
    } catch {
      // Use as-is if parsing fails
    }
    return trackers.includes(domain);
  });
}

function matchesTag(torrent: TorrentProperties, tags: string[]): boolean {
  const includeUntagged = tags.includes('untagged');
  return (includeUntagged && torrent.tags.length === 0) || torrent.tags.some((tag) => tags.includes(tag));
}

function filterTorrents(
  torrentList: TorrentProperties[],
  opts: LocationFilter | StatusFilter | TrackerFilter | TagFilter,
): TorrentProperties[] {
  let result = torrentList;

  // Apply inclusion filter
  if (opts.filter.length) {
    if (opts.type === 'location') {
      result = result.filter((torrent) => matchesLocation(torrent, opts.filter));
    } else if (opts.type === 'status') {
      result = result.filter((torrent) => matchesStatus(torrent, opts.filter));
    } else if (opts.type === 'tracker') {
      result = result.filter((torrent) => matchesTracker(torrent, opts.filter));
    } else if (opts.type === 'tag') {
      result = result.filter((torrent) => matchesTag(torrent, opts.filter));
    }
  }

  // Apply exclusion filter
  if (opts.excludeFilter?.length) {
    if (opts.type === 'location') {
      result = result.filter((torrent) => !matchesLocation(torrent, opts.excludeFilter!));
    } else if (opts.type === 'status') {
      result = result.filter((torrent) => !matchesStatus(torrent, opts.excludeFilter as TorrentStatus[]));
    } else if (opts.type === 'tracker') {
      result = result.filter((torrent) => !matchesTracker(torrent, opts.excludeFilter!));
    } else if (opts.type === 'tag') {
      result = result.filter((torrent) => !matchesTag(torrent, opts.excludeFilter!));
    }
  }

  return result;
}

export default filterTorrents;
