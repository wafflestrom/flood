import {makeAutoObservable} from 'mobx';
import jsonpatch, {Operation} from 'fast-json-patch';
import {KeyboardEvent, MouseEvent, TouchEvent} from 'react';

import type {Taxonomy} from '@shared/types/Taxonomy';
import torrentStatusMap, {TorrentStatus} from '@shared/constants/torrentStatusMap';

class TorrentFilterStore {
  locationFilter: Array<string> = [];
  searchFilter = '';
  statusFilter: Array<TorrentStatus> = [];
  tagFilter: Array<string> = [];
  trackerFilter: Array<string> = [];

  locationExcludeFilter: Array<string> = [];
  statusExcludeFilter: Array<TorrentStatus> = [];
  tagExcludeFilter: Array<string> = [];
  trackerExcludeFilter: Array<string> = [];

  filterTrigger = false;

  taxonomy: Taxonomy = {
    locationTree: {directoryName: '', fullPath: '', children: [], containedCount: 0, containedSize: 0},
    statusCounts: {},
    statusSizes: {},
    tagCounts: {},
    tagSizes: {},
    trackerCounts: {},
    trackerSizes: {},
  };

  get isFilterActive() {
    return (
      this.locationFilter.length ||
      this.searchFilter !== '' ||
      this.statusFilter.length ||
      this.tagFilter.length ||
      this.trackerFilter.length ||
      this.locationExcludeFilter.length ||
      this.statusExcludeFilter.length ||
      this.tagExcludeFilter.length ||
      this.trackerExcludeFilter.length
    );
  }

  constructor() {
    makeAutoObservable(this);
  }

  clearAllFilters() {
    this.locationFilter = [];
    this.searchFilter = '';
    this.statusFilter = [];
    this.tagFilter = [];
    this.trackerFilter = [];
    this.locationExcludeFilter = [];
    this.statusExcludeFilter = [];
    this.tagExcludeFilter = [];
    this.trackerExcludeFilter = [];
    this.filterTrigger = !this.filterTrigger;
  }

  handleTorrentTaxonomyDiffChange(diff: Operation[]) {
    jsonpatch.applyPatch(this.taxonomy, diff);
  }

  handleTorrentTaxonomyFullUpdate(taxonomy: Taxonomy) {
    this.taxonomy = taxonomy;
  }

  setSearchFilter(filter: string) {
    this.searchFilter = filter;
    this.filterTrigger = !this.filterTrigger;
  }

  setLocationFilters(filter: string | '', event: KeyboardEvent | MouseEvent | TouchEvent) {
    // keys: [] to disable shift-clicking as it doesn't make sense in a tree
    this.computeFilters([], this.locationFilter, this.locationExcludeFilter, filter, event);
    this.filterTrigger = !this.filterTrigger;
  }

  setStatusFilters(filter: TorrentStatus | '', event: KeyboardEvent | MouseEvent | TouchEvent) {
    this.computeFilters(torrentStatusMap, this.statusFilter, this.statusExcludeFilter, filter, event);
    this.filterTrigger = !this.filterTrigger;
  }

  setTagFilters(filter: string, event: KeyboardEvent | MouseEvent | TouchEvent) {
    const tags = Object.keys(this.taxonomy.tagCounts).sort((a, b) => {
      if (a === 'untagged') return -1;
      else if (b === 'untagged') return 1;
      else return a.localeCompare(b);
    });

    // Put 'untagged' in the correct second position for shift click ordering
    tags.splice(tags.indexOf('untagged'), 1);
    tags.splice(1, 0, 'untagged');

    this.computeFilters(tags, this.tagFilter, this.tagExcludeFilter, filter, event);
    this.filterTrigger = !this.filterTrigger;
  }

  setTrackerFilters(filter: string, event: KeyboardEvent | MouseEvent | TouchEvent) {
    const trackers = Object.keys(this.taxonomy.trackerCounts).sort((a, b) => a.localeCompare(b));

    this.computeFilters(trackers, this.trackerFilter, this.trackerExcludeFilter, filter, event);
    this.filterTrigger = !this.filterTrigger;
  }

  private computeFilters<T extends TorrentStatus | string>(
    keys: readonly T[],
    currentFilters: Array<T>,
    excludeFilters: Array<T>,
    newFilter: T,
    event: KeyboardEvent | MouseEvent | TouchEvent,
  ) {
    if (newFilter === ('' as T)) {
      // Clicking "All" clears both inclusions and exclusions
      currentFilters.splice(0);
      excludeFilters.splice(0);
    } else if (event.altKey) {
      // Alt/Opt+Click: toggle exclusion
      if (excludeFilters.includes(newFilter)) {
        // Already excluded — remove exclusion
        excludeFilters.splice(excludeFilters.indexOf(newFilter), 1);
      } else {
        // Add to exclusion, remove from inclusion if present
        if (currentFilters.includes(newFilter)) {
          currentFilters.splice(currentFilters.indexOf(newFilter), 1);
        }
        excludeFilters.push(newFilter);
      }
    } else if (event.shiftKey && keys.length) {
      if (currentFilters.length) {
        const lastKey = currentFilters[currentFilters.length - 1];
        const lastKeyIndex = keys.indexOf(lastKey);
        let currentKeyIndex = keys.indexOf(newFilter);

        if (!~currentKeyIndex || !~lastKeyIndex) {
          return;
        }

        const increment = currentKeyIndex > lastKeyIndex ? -1 : 1;

        for (; currentKeyIndex !== lastKeyIndex; currentKeyIndex += increment) {
          const foundKey = keys[currentKeyIndex] as T;
          if (!currentFilters.includes(foundKey)) {
            currentFilters.push(foundKey);
          }
          // Remove from exclude if range-selecting into inclusion
          if (excludeFilters.includes(foundKey)) {
            excludeFilters.splice(excludeFilters.indexOf(foundKey), 1);
          }
        }
      } else {
        currentFilters.splice(0, currentFilters.length, newFilter);
        // Remove from exclude if selecting
        if (excludeFilters.includes(newFilter)) {
          excludeFilters.splice(excludeFilters.indexOf(newFilter), 1);
        }
      }
    } else if (event.metaKey || event.ctrlKey) {
      if (currentFilters.includes(newFilter)) {
        currentFilters.splice(currentFilters.indexOf(newFilter), 1);
      } else {
        // Remove from exclude when Ctrl/Cmd clicking into inclusion
        if (excludeFilters.includes(newFilter)) {
          excludeFilters.splice(excludeFilters.indexOf(newFilter), 1);
        }
        currentFilters.push(newFilter);
      }
    } else {
      // Regular click: if excluded, switch to included; otherwise single-select
      if (excludeFilters.includes(newFilter)) {
        excludeFilters.splice(excludeFilters.indexOf(newFilter), 1);
      }
      currentFilters.splice(0, currentFilters.length, newFilter);
    }
  }
}

export default new TorrentFilterStore();
