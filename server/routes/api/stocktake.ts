import type {FastifyInstance} from 'fastify';

import {getRequiredAuthContext} from '../../middleware/authenticate';
import {getStocktakeResult, runStocktakeScan} from '../../services/stocktakeService';

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
      return result ?? {status: 'no_scan', message: 'No stocktake scan has been performed yet.'};
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
      const result = await runStocktakeScan(authedContext.services);
      return result;
    },
  );
};

export default stocktakeRoutes;
