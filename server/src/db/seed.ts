import { pool } from './client';
import { seedCatalog } from './catalog';

console.log('Seeded', await seedCatalog());
await pool.end();
