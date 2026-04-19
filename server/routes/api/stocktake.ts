import fs from 'node:fs';
import path from 'node:path';

import type {FastifyInstance} from 'fastify';

import {getRequiredAuthContext} from '../../middleware/authenticate';
import {getStocktakeResult, runStocktakeScan} from '../../services/stocktakeService';
import {clearCachedMatchResult, getCachedMatchResult, runTorrentMatch} from '../../services/torrentMatchService';
import {isAllowedPath, sanitizePath} from '../../util/fileUtil';

const stocktakeRoutes = async (fastify: FastifyInstance) => {
  fastify.get(
    '/',
    {
      schema: {
        summary: 'Get cached stocktake result',
        description: 'Returns the most recent stocktake scan result, or null if no scan has been performed.',
        tags: ['Stocktake'],
        security: [{User: []}],
      },
    },
    async () => {
      const result = await getStocktakeResult();
      if (!result) {
        return {status: 'no_scan', message: 'No stocktake scan has been performed yet.'};
      }
      return {...result, cachedMatchResult: getCachedMatchResult()};
    },
  );

  fastify.post(
    '/scan',
    {
      schema: {
        summary: 'Run stocktake scan',
        description:
          'Triggers a fresh scan of configured directories and cross-references with loaded torrents. Returns the full stocktake result.',
        tags: ['Stocktake'],
        security: [{User: []}],
      },
    },
    async (request) => {
      const authedContext = getRequiredAuthContext(request);
      clearCachedMatchResult();
      const result = await runStocktakeScan(authedContext.services);
      return result;
    },
  );

  fastify.post<{Body: {torrentDir: string}}>(
    '/match-torrents',
    {
      schema: {
        summary: 'Match .torrent files to untied disk entries',
        description:
          'Recursively scans a directory for .torrent files, parses them, and matches by name against untied files from the last stocktake scan.',
        tags: ['Stocktake'],
        security: [{User: []}],
      },
    },
    async (request, reply) => {
      const {torrentDir} = request.body ?? {};
      if (!torrentDir || typeof torrentDir !== 'string') {
        return reply.status(400).send({message: 'torrentDir is required'});
      }

      let sanitized: string;
      try {
        sanitized = sanitizePath(torrentDir);
      } catch {
        return reply.status(400).send({message: 'Invalid directory path'});
      }

      if (!isAllowedPath(sanitized)) {
        return reply.status(403).send({message: 'Access denied to the specified directory'});
      }

      try {
        const stat = await fs.promises.stat(sanitized);
        if (!stat.isDirectory()) {
          return reply.status(400).send({message: 'Path is not a directory'});
        }
      } catch {
        return reply.status(404).send({message: 'Directory not found'});
      }

      const result = await runTorrentMatch(sanitized);
      return result;
    },
  );

  fastify.post<{Body: {torrentPath: string; destination: string}}>(
    '/add-matched',
    {
      schema: {
        summary: 'Add a matched .torrent to the client',
        description:
          'Reads a .torrent file from disk and adds it to the torrent client in stopped+hashing mode, pointed at the existing data location.',
        tags: ['Stocktake'],
        security: [{User: []}],
      },
    },
    async (request, reply) => {
      const authedContext = getRequiredAuthContext(request);
      const {torrentPath, destination} = request.body ?? {};

      if (!torrentPath || typeof torrentPath !== 'string') {
        return reply.status(400).send({message: 'torrentPath is required'});
      }
      if (!destination || typeof destination !== 'string') {
        return reply.status(400).send({message: 'destination is required'});
      }

      let sanitizedTorrent: string;
      let sanitizedDest: string;
      try {
        sanitizedTorrent = sanitizePath(torrentPath);
        sanitizedDest = sanitizePath(destination);
      } catch {
        return reply.status(400).send({message: 'Invalid path'});
      }

      if (!isAllowedPath(sanitizedTorrent) || !isAllowedPath(sanitizedDest)) {
        return reply.status(403).send({message: 'Access denied'});
      }

      let torrentData: Buffer;
      try {
        torrentData = await fs.promises.readFile(sanitizedTorrent);
      } catch {
        return reply.status(404).send({message: 'Torrent file not found'});
      }

      // The destination is the untied disk entry path. For isBasePath=false,
      // the torrent client will append info.name under the destination dir.
      // So we always use the parent directory of the matched entry.
      const destDir = path.dirname(sanitizedDest);

      const hashes = await authedContext.services.clientGatewayService.addTorrentsByFile({
        files: [torrentData.toString('base64')] as [string, ...string[]],
        destination: destDir,
        tags: [],
        isBasePath: false,
        isCompleted: true,
        isSequential: false,
        isInitialSeeding: false,
        start: false,
      });

      authedContext.services.torrentService.fetchTorrentList();

      return {hashes, name: path.basename(sanitizedTorrent, '.torrent')};
    },
  );
};

export default stocktakeRoutes;
