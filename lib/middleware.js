const { Pool } = require('pg');
const dotenv = require('dotenv');
const routes = require('./routes');
const logger = require('./logger'); // Implement proper logging
const retry = require('async-retry'); // Add retry logic for table creation
dotenv.config();



// Configure connection pool with proper SSL and limits
const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: process.env.NODE_ENV === 'production' ? { 
    rejectUnauthorized: true,
    ca: process.env.DB_CA_CERT // Add CA certificate for production
  } : false,
  min: 2,
  max: 10,
  idleTimeoutMillis: 30000,
  connectionTimeoutMillis: 5000
});

// Add error handling for pool events
pool.on('error', (err) => {
  logger.error('Unexpected database pool error:', err);
  process.exit(-1);
});

// Table schema with indexes and optimized data types
const SCHEMA = `
  CREATE TABLE IF NOT EXISTS pageviews (
    id BIGSERIAL PRIMARY KEY,
    url VARCHAR(2048) NOT NULL,
    user_agent VARCHAR(512),
    ip_address INET NOT NULL,
    page_load_time INT CHECK (page_load_time BETWEEN 0 AND 60000),
    screen_resolution VARCHAR(20),
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
  );
  
  CREATE INDEX IF NOT EXISTS pageviews_created_at_idx ON pageviews(created_at);
  CREATE INDEX IF NOT EXISTS pageviews_url_idx ON pageviews(url);

  CREATE TABLE IF NOT EXISTS events (
    id BIGSERIAL PRIMARY KEY,
    url VARCHAR(2048) NOT NULL,
    user_agent VARCHAR(512) NOT NULL,
    ip_address INET NOT NULL,
    event_name VARCHAR(64) NOT NULL,
    event_category VARCHAR(64) NOT NULL,
    event_label VARCHAR(64),
    payload JSONB CHECK (octet_length(payload::text) <= 2048),
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
  );
  
  CREATE INDEX IF NOT EXISTS events_created_at_idx ON events(created_at);
  CREATE INDEX IF NOT EXISTS events_event_name_idx ON events(event_name);
  CREATE INDEX IF NOT EXISTS events_event_category_idx ON events(event_category);
`;

// Enhanced table creation with retries and validation
async function createAnalyticsTables() {
  return retry(
    async (bail) => {
      try {
        await pool.query('BEGIN');
        
        // Create tables and indexes
        await pool.query(SCHEMA);
        
        // Add column if missing (for schema migrations)
        await pool.query(`
          ALTER TABLE pageviews 
          ADD COLUMN IF NOT EXISTS screen_resolution VARCHAR(20)
        `);
        
        await pool.query('COMMIT');
        logger.info('Analytics tables initialized successfully');
      } catch (error) {
        await pool.query('ROLLBACK');
        logger.error('Database schema initialization failed:', error);
        throw error; // Retry unless fatal
      }
    },
    {
      retries: 5,
      minTimeout: 2000,
      factor: 2,
      onRetry: (error) => {
        logger.warn(`Retrying table creation after error: ${error.message}`);
      }
    }
  );
}

// Health check function for readiness probes
async function checkDatabaseHealth() {
  try {
    const result = await pool.query('SELECT 1');
    return result.rowCount === 1;
  } catch (error) {
    logger.error('Database health check failed:', error);
    return false;
  }
}

// Async initialization wrapper
let isInitialized = false;
async function initializeDataForge() {
  if (isInitialized) return true;
  
  try {
    await createAnalyticsTables();
    isInitialized = true;
    return true;
  } catch (error) {
    logger.error('DataForge initialization failed:', error);
    throw error;
  }
}

// Enhanced middleware with health checks
function DataForge(app) {
  // Add pre-route middleware
  app.use('/dataforge/analytics', async (req, res, next) => {
    if (!isInitialized) {
      return res.status(503).json({
        error: 'Service initializing',
        status: checkDatabaseHealth() ? 'warming_up' : 'unhealthy'
      });
    }
    next();
  });

  // Mount routes after initialization
  initializeDataForge()
    .then(() => {
      app.use('/dataforge/analytics', routes);
      logger.info('DataForge analytics routes mounted');
    })
    .catch(error => {
      logger.error('Failed to initialize DataForge:', error);
      process.exit(1); // Fail fast if initialization fails
    });

  // Add health check endpoint
  app.get('/dataforge/health', async (req, res) => {
    const dbHealthy = await checkDatabaseHealth();
    res.status(dbHealthy ? 200 : 503).json({
      db: dbHealthy ? 'connected' : 'disconnected',
      initialized: isInitialized,
      timestamp: new Date().toISOString()
    });
  });
}

// Graceful shutdown handling
process.on('SIGTERM', async () => {
  logger.info('Shutting down DataForge pool...');
  await pool.end();
  logger.info('Pool closed');
});

process.on('SIGINT', async () => {
  logger.info('Received SIGINT - closing pool');
  await pool.end();
  process.exit(0);
});

module.exports = DataForge;