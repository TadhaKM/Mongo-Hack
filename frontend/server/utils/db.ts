// Read-only connection to the mend.ai MongoDB Atlas database, for the /database page. Set MONGODB_URI (and optionally MONGODB_DB)
// in the hosting environment. Without it the app still works: the page just says the database is not connected.
import { MongoClient, type Db } from 'mongodb'

let client: Promise<MongoClient> | null = null

export async function engineDb(): Promise<Db | null> {
  const uri = process.env.MONGODB_URI
  if (!uri) return null
  client ??= new MongoClient(uri, { serverSelectionTimeoutMS: 8000, maxPoolSize: 3 }).connect().catch((e) => { client = null; throw e })
  return (await client).db(process.env.MONGODB_DB || 'rentcheck_engine')
}
