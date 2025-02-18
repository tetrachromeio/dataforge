const express = require('express');
const router = express.Router();
const { Pool } = require('pg');
const dotenv = require('dotenv');
const axios = require('axios');
const fs = require('fs');
const path = require('path');
const ipaddr = require('ipaddr.js');
const rateLimit = require('express-rate-limit');
const helmet = require('helmet');
const logger = require('./logger'); // Implement a proper logger

dotenv.config();




// Database connection pool with retry logic
const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: process.env.NODE_ENV === 'production' ? { rejectUnauthorized: true } : false,
  min: 2,
  max: 10
});

let isDbConnected = false;

const initializeDb = async (retries = 3) => {
  for (let i = 0; i < retries; i++) {
    try {
      await pool.query('SELECT 1'); // Test connection
      isDbConnected = true;
      logger.info('Database connected successfully');
      return;
    } catch (error) {
      logger.error(`Database connection attempt ${i + 1} failed: ${error.message}`);
      if (i === retries - 1) throw error;
      await new Promise(res => setTimeout(res, 5000));
    }
  }
};

initializeDb().catch(err => {
  logger.error('Failed to initialize database:', err);
  process.exit(1);
});

// Security middleware
router.use(helmet());
router.use(express.json({ limit: '50kb' }));

// Rate limiting
const apiLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 500,
  standardHeaders: true,
  legacyHeaders: false,
  handler: (req, res) => {
    logger.warn(`Rate limit exceeded for IP: ${req.ip}`);
    res.status(429).json({ error: 'Too many requests' });
  }
});

router.use('/api/v1', apiLimiter);

// Input validation functions
const validateEvent = (data) => {
  const requiredFields = {
    pageview: ['url', 'user_agent'],
    event: ['url', 'user_agent', 'event_name', 'event_category'],
    'pageview-anon': ['url', 'user_agent']
  };

  if (!Object.keys(requiredFields).includes(data.type)) {
    return { valid: false, message: 'Invalid event type' };
  }

  const missing = requiredFields[data.type].filter(field => !data[field]);
  if (missing.length > 0) {
    return { valid: false, message: `Missing fields: ${missing.join(', ')}` };
  }

  if (data.url && data.url.length > 2048) {
    return { valid: false, message: 'URL exceeds maximum length' };
  }

  if (data.page_load_time && typeof data.page_load_time !== 'number') {
    return { valid: false, message: 'Invalid page load time format' };
  }

  return { valid: true };
};

// IP validation with proper IPv4/6 parsing
const getValidIp = (rawIp) => {
  try {
    const firstIp = (rawIp || '')
      .split(',')[0]
      .trim()
      .replace('::ffff:', ''); // Handle IPv4-mapped IPv6

    // Parse and validate the IP
    const parsed = ipaddr.parse(firstIp);
    
    // Return string representation for database storage
    return parsed.toString();
  } catch (error) {
    logger.warn(`Invalid IP address: ${rawIp}`, { error: error.message });
    return '0.0.0.0';
  }
};

// Cached client script
let clientScript = null;
try {
  clientScript = fs.readFileSync(
    path.join(__dirname, 'client.js'), 
    'utf8'
  );
  logger.info('Client script loaded successfully');
} catch (error) {
  logger.error('Failed to load client script:', error);
  process.exit(1);
}

router.post('/api/v1', async (req, res) => {
  if (!isDbConnected) {
    return res.status(503).json({ error: 'Service unavailable' });
  }

  const data = req.body;
  const validation = validateEvent(data);
  
  if (!validation.valid) {
    logger.warn('Invalid request:', validation.message);
    return res.status(400).json({ error: validation.message });
  }

  try {
    const rawIp = req.ip || req.headers['x-forwarded-for'] || req.socket.remoteAddress || '';
    const clientIp = getValidIp(rawIp);

    const queryParams = {
      url: data.url.substring(0, 2048),
      user_agent: data.user_agent.substring(0, 512),
      ip_address: clientIp
    };

    switch (data.type) {
      case 'pageview':
        await pool.query(
          `INSERT INTO pageviews 
           (url, user_agent, ip_address, page_load_time, screen_resolution)
           VALUES ($1, $2, $3, $4, $5)`,
          [
            queryParams.url,
            queryParams.user_agent,
            queryParams.ip_address,
            Number(data.page_load_time) || null,
            data.screen_resolution ? String(data.screen_resolution).substring(0, 32) : null
          ]
        );
        break;

      case 'event':
        await pool.query(
          `INSERT INTO events 
           (url, user_agent, ip_address, event_name, event_category, event_label, payload)
           VALUES ($1, $2, $3, $4, $5, $6, $7)`,
          [
            queryParams.url,
            queryParams.user_agent,
            queryParams.ip_address,
            String(data.event_name).substring(0, 64),
            String(data.event_category).substring(0, 64),
            data.event_label ? String(data.event_label).substring(0, 64) : null,
            data.payload ? JSON.stringify(data.payload).substring(0, 2048) : null
          ]
        );
        break;

      case 'pageview-anon':
        await pool.query(
          `INSERT INTO pageviews 
           (url, user_agent, ip_address)
           VALUES ($1, $2, $3)`,
          [
            queryParams.url,
            queryParams.user_agent,
            queryParams.ip_address
          ]
        );
        break;
    }

    res.status(200).json({ status: 'success' });
  } catch (error) {
    logger.error('Database operation failed:', {
      error: error.message,
      stack: error.stack,
      type: data.type,
      ip: clientIp
    });
    
    res.status(500).json({ 
      error: 'Failed to process request',
      requestId: res.locals.requestId // Implement request ID tracking
    });
  }
});

router.get('/static/v1/dataforge-client.js', (req, res) => {
  res
    .set('Content-Type', 'application/javascript')
    .set('Cache-Control', 'public, max-age=86400')
    .send(clientScript);
});

// Graceful shutdown
process.on('SIGTERM', async () => {
  logger.info('Shutting down gracefully...');
  await pool.end();
  process.exit(0);
});

process.on('SIGINT', async () => {
  logger.info('Received SIGINT');
  await pool.end();
  process.exit(0);
});

module.exports = router;