import axios from 'axios';
import {FC, useCallback, useEffect, useState} from 'react';

import ConfigStore from '@client/stores/ConfigStore';
import type {StocktakeAddedTorrent, StocktakeMatchResult, StocktakeResult} from '@shared/types/Stocktake';

import Modal from '../Modal';

import StocktakeAdded from './StocktakeAdded';
import StocktakeDashboard from './StocktakeDashboard';
import StocktakeDiskUsage from './StocktakeDiskUsage';
import StocktakeOrphaned from './StocktakeOrphaned';
import StocktakeTorrents from './StocktakeTorrents';
import StocktakeUntied from './StocktakeUntied';

const {baseURI} = ConfigStore;

const StocktakeModal: FC = () => {
  const [result, setResult] = useState<StocktakeResult | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Torrent matching state
  const [torrentDir, setTorrentDir] = useState('');
  const [matchResult, setMatchResult] = useState<StocktakeMatchResult | null>(null);
  const [isMatching, setIsMatching] = useState(false);
  const [matchError, setMatchError] = useState<string | null>(null);
  const [addedTorrents, setAddedTorrents] = useState<StocktakeAddedTorrent[]>([]);

  const fetchCached = useCallback(async () => {
    try {
      const response = await axios.get(`${baseURI}api/stocktake`);
      if (response.data && response.data.summary) {
        setResult(response.data as StocktakeResult);
      }
    } catch {
      // no cached result available
    }
  }, []);

  const runScan = useCallback(async () => {
    setIsLoading(true);
    setError(null);
    try {
      const response = await axios.post(`${baseURI}api/stocktake/scan`);
      setResult(response.data as StocktakeResult);
    } catch (e) {
      const msg = e instanceof Error ? e.message : 'Scan failed';
      setError(msg);
    } finally {
      setIsLoading(false);
    }
  }, []);

  const runMatch = useCallback(async () => {
    if (!torrentDir.trim()) return;
    setIsMatching(true);
    setMatchError(null);
    try {
      const response = await axios.post(`${baseURI}api/stocktake/match-torrents`, {torrentDir: torrentDir.trim()});
      setMatchResult(response.data as StocktakeMatchResult);
    } catch (e) {
      const msg =
        axios.isAxiosError(e) && e.response?.data?.message
          ? (e.response.data.message as string)
          : e instanceof Error
          ? e.message
          : 'Matching failed';
      setMatchError(msg);
    } finally {
      setIsMatching(false);
    }
  }, [torrentDir]);

  const handleTorrentAdded = useCallback((added: StocktakeAddedTorrent) => {
    setAddedTorrents((prev) => [added, ...prev]);
  }, []);

  useEffect(() => {
    fetchCached();
  }, [fetchCached]);

  if (!result && !isLoading && !error) {
    return (
      <Modal
        key="stocktake-empty"
        heading="Stocktake"
        size="large"
        actions={[
          {
            clickHandler: null,
            content: 'Close',
            triggerDismiss: true,
            type: 'tertiary',
          },
          {
            clickHandler: () => {
              runScan();
            },
            content: 'Run Scan',
            triggerDismiss: false,
            type: 'primary',
          },
        ]}
        content={
          <div className="stocktake__empty-state">
            <p>
              No stocktake data available. Click &quot;Run Scan&quot; to scan directories and cross-reference with
              loaded torrents.
            </p>
          </div>
        }
      />
    );
  }

  if (isLoading) {
    return (
      <Modal
        key="stocktake-loading"
        heading="Stocktake"
        size="large"
        actions={[
          {
            clickHandler: null,
            content: 'Close',
            triggerDismiss: true,
            type: 'tertiary',
          },
        ]}
        content={
          <div className="stocktake__loading">
            <div className="stocktake__spinner" />
            <p>Scanning directories and cross-referencing torrents...</p>
          </div>
        }
      />
    );
  }

  if (error) {
    return (
      <Modal
        key="stocktake-error"
        heading="Stocktake"
        size="large"
        actions={[
          {
            clickHandler: null,
            content: 'Close',
            triggerDismiss: true,
            type: 'tertiary',
          },
          {
            clickHandler: () => {
              runScan();
            },
            content: 'Retry',
            triggerDismiss: false,
            type: 'primary',
          },
        ]}
        content={
          <div className="stocktake__error">
            <p>Error: {error}</p>
          </div>
        }
      />
    );
  }

  if (!result) return null;

  const matchCountLabel = matchResult ? ` · ${matchResult.matches.length} matched` : '';

  const tabs = {
    dashboard: {
      content: StocktakeDashboard,
      props: {
        summary: result.summary,
        scanDirs: result.scanDirs,
      },
      label: `Dashboard`,
    },
    untied: {
      content: StocktakeUntied,
      props: {
        untiedFiles: result.untiedFiles,
        matchResult,
        isMatching,
        matchError,
        torrentDir,
        onTorrentDirChange: setTorrentDir,
        onRunMatch: runMatch,
        onTorrentAdded: handleTorrentAdded,
      },
      label: `Untied (${result.summary.untiedCount}${matchCountLabel})`,
    },
    orphaned: {
      content: StocktakeOrphaned,
      props: {
        orphanedTorrents: result.orphanedTorrents,
      },
      label: `Orphaned (${result.summary.orphanedCount})`,
    },
    torrents: {
      content: StocktakeTorrents,
      props: {
        allTorrents: result.allTorrents,
      },
      label: `All Torrents (${result.summary.totalTorrents})`,
    },
    diskUsage: {
      content: StocktakeDiskUsage,
      props: {
        dirBreakdown: result.dirBreakdown,
        untiedFiles: result.untiedFiles,
        matchResult,
      },
      label: 'Disk Usage',
    },
    ...(addedTorrents.length > 0
      ? {
          added: {
            content: StocktakeAdded,
            props: {
              addedTorrents,
            },
            label: `Added (${addedTorrents.length})`,
          },
        }
      : {}),
  };

  return (
    <Modal
      key="stocktake-result"
      heading="Stocktake"
      size="large"
      orientation="vertical"
      className="stocktake__modal"
      tabs={tabs}
      actions={[
        {
          clickHandler: null,
          content: 'Close',
          triggerDismiss: true,
          type: 'tertiary',
        },
        {
          clickHandler: () => {
            runScan();
          },
          isLoading,
          content: 'Re-scan',
          triggerDismiss: false,
          type: 'primary',
        },
      ]}
    />
  );
};

export default StocktakeModal;
