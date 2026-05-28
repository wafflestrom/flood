import {applyPatch, Operation} from 'fast-json-patch';
import {makeAutoObservable} from 'mobx';
import type React from 'react';

import filterTorrents from '@client/util/filterTorrents';
import selectTorrents from '@client/util/selectTorrents';
import sortTorrents from '@client/util/sortTorrents';
import termMatch from '@client/util/termMatch';

import type {TorrentProperties, TorrentList} from '@shared/types/Torrent';

import SettingStore from './SettingStore';
import TorrentFilterStore from './TorrentFilterStore';

class TorrentStore {
  selectedTorrents: Array<string> = [];
  torrents: TorrentList = {};

  constructor() {
    makeAutoObservable(this);
  }

  get sortedTorrents(): Array<TorrentProperties> {
    return sortTorrents(Object.values(this.torrents), SettingStore.floodSettings.sortTorrents);
  }

  get filteredTorrents(): Array<TorrentProperties> {
    const {
      locationFilter,
      locationExcludeFilter,
      searchFilter,
      statusFilter,
      statusExcludeFilter,
      tagFilter,
      tagExcludeFilter,
      trackerFilter,
      trackerExcludeFilter,
    } = TorrentFilterStore;

    let filteredTorrents = Object.assign([], this.sortedTorrents) as Array<TorrentProperties>;

    if (locationFilter.length || locationExcludeFilter.length) {
      filteredTorrents = filterTorrents(filteredTorrents, {
        type: 'location',
        filter: locationFilter,
        excludeFilter: locationExcludeFilter,
      });
    }

    if (searchFilter !== '') {
      const nameMatchedHashes = new Set(
        termMatch(filteredTorrents, (properties) => properties.name, searchFilter).map((p) => p.hash),
      );
      // Fuzzy match torrent names, exact match infohash (after trim/lowercase).
      const normalizedSearchFilter = searchFilter.trim().toLowerCase();

      filteredTorrents = filteredTorrents.filter(
        (properties) =>
          nameMatchedHashes.has(properties.hash) ||
          (normalizedSearchFilter !== '' && properties.hash.toLowerCase() === normalizedSearchFilter),
      );
    }

    if (statusFilter.length || statusExcludeFilter.length) {
      filteredTorrents = filterTorrents(filteredTorrents, {
        type: 'status',
        filter: statusFilter,
        excludeFilter: statusExcludeFilter,
      });
    }

    if (tagFilter.length || tagExcludeFilter.length) {
      filteredTorrents = filterTorrents(filteredTorrents, {
        type: 'tag',
        filter: tagFilter,
        excludeFilter: tagExcludeFilter,
      });
    }

    if (trackerFilter.length || trackerExcludeFilter.length) {
      filteredTorrents = filterTorrents(filteredTorrents, {
        type: 'tracker',
        filter: trackerFilter,
        excludeFilter: trackerExcludeFilter,
      });
    }

    return filteredTorrents;
  }

  setSelectedTorrents({event, hash}: {event: React.KeyboardEvent | React.MouseEvent | React.TouchEvent; hash: string}) {
    this.selectedTorrents = selectTorrents({
      event,
      hash,
      selectedTorrents: this.selectedTorrents,
      torrentList: this.filteredTorrents,
    });
  }

  selectAllTorrents() {
    this.selectedTorrents = this.filteredTorrents.map((v) => v.hash);
  }

  deselectAllTorrents() {
    this.selectedTorrents = [];
  }

  handleTorrentListDiffChange(torrentListDiffs: Operation[]) {
    applyPatch(this.torrents, torrentListDiffs);
  }

  handleTorrentListFullUpdate(torrentList: TorrentList) {
    this.torrents = torrentList;
  }
}

export default new TorrentStore();
