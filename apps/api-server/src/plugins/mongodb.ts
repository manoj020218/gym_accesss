import fp from 'fastify-plugin';
import type { FastifyPluginAsync } from 'fastify';
import mongoose from 'mongoose';
import { config } from '../config.js';

const mongoPlugin: FastifyPluginAsync = async (fastify) => {
  await mongoose.connect(config.MONGODB_URI, {
    maxPoolSize: 10,
    serverSelectionTimeoutMS: 5000,
  });

  fastify.log.info('MongoDB connected');

  fastify.addHook('onClose', async () => {
    await mongoose.disconnect();
    fastify.log.info('MongoDB disconnected');
  });
};

export default fp(mongoPlugin, { name: 'mongodb' });
