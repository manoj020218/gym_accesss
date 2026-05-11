import { MongoMemoryServer, MongoBinary } from 'mongodb-memory-server';
import mongoose from 'mongoose';

let mongod: MongoMemoryServer;

export async function startMongo(): Promise<void> {
  // Increase startup timeout — Windows first-run extraction can be slow
  process.env['MONGOMS_STARTUP_TIMEOUT']  = '120000';
  process.env['MONGOMS_DOWNLOAD_TIMEOUT'] = '120000';

  // Pre-download binary if missing (avoids timeout during instance startup)
  await MongoBinary.getPath();

  mongod = await MongoMemoryServer.create();
  await mongoose.connect(mongod.getUri(), { serverSelectionTimeoutMS: 30_000 });
}

export async function stopMongo(): Promise<void> {
  await mongoose.disconnect();
  await mongod.stop();
}

export async function clearMongo(): Promise<void> {
  const collections = mongoose.connection.collections;
  await Promise.all(
    Object.values(collections).map(col => col.deleteMany({})),
  );
}
