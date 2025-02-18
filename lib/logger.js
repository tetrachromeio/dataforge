// logger.js
const { createLogger, format, transports } = require('winston');
const { combine, timestamp, json, printf, errors } = format;
const DailyRotateFile = require('winston-daily-rotate-file');
const path = require('path');

// Environment variables
const env = process.env.NODE_ENV || 'development';
const serviceName = process.env.SERVICE_NAME || 'dataforge-analytics';
const logDir = process.env.LOG_DIR || path.join(process.cwd(), 'logs');

// Custom format for console output
const consoleFormat = printf(({ level, message, timestamp, stack, ...metadata }) => {
  let msg = `${timestamp} [${level}] ${message}`;
  if (stack) msg += `\n${stack}`;
  if (metadata && Object.keys(metadata).length) msg += ` ${JSON.stringify(metadata)}`;
  return msg;
});

// Base transports for all environments
const baseTransports = [
  new DailyRotateFile({
    filename: path.join(logDir, 'error-%DATE%.log'),
    datePattern: 'YYYY-MM-DD',
    zippedArchive: true,
    maxSize: '20m',
    maxFiles: '30d',
    level: 'error',
    format: combine(
      errors({ stack: true }),
      json()
    )
  }),
  new DailyRotateFile({
    filename: path.join(logDir, 'combined-%DATE%.log'),
    datePattern: 'YYYY-MM-DD',
    zippedArchive: true,
    maxSize: '20m',
    maxFiles: '7d',
    format: json()
  })
];

// Development-specific transports
const devTransports = [
  new transports.Console({
    level: 'debug',
    format: combine(
      format.colorize(),
      timestamp({ format: 'YYYY-MM-DD HH:mm:ss' }),
      errors({ stack: true }),
      consoleFormat
    )
  })
];

// Production-specific transports
const prodTransports = [
  new transports.Console({
    level: 'info',
    format: combine(
      timestamp({ format: 'YYYY-MM-DD HH:mm:ss' }),
      errors({ stack: true }),
      json()
    )
  })
];

// Create the logger
const logger = createLogger({
  level: env === 'development' ? 'debug' : 'info',
  defaultMeta: {
    service: serviceName,
    environment: env,
    pid: process.pid
  },
  format: combine(
    timestamp(),
    errors({ stack: true }),
    json()
  ),
  transports: [
    ...baseTransports,
    ...(env === 'development' ? devTransports : prodTransports)
  ],
  exceptionHandlers: [
    new DailyRotateFile({
      filename: path.join(logDir, 'exceptions-%DATE%.log'),
      datePattern: 'YYYY-MM-DD',
      zippedArchive: true,
      maxSize: '20m',
      maxFiles: '30d'
    })
  ],
  rejectionHandlers: [
    new DailyRotateFile({
      filename: path.join(logDir, 'rejections-%DATE%.log'),
      datePattern: 'YYYY-MM-DD',
      zippedArchive: true,
      maxSize: '20m',
      maxFiles: '30d'
    })
  ]
});

// Add HTTP request logging middleware
logger.expressMiddleware = function(req, res, next) {
  const start = Date.now();

  res.on('finish', () => {
    const duration = Date.now() - start;
    logger.info('HTTP request', {
      method: req.method,
      url: req.originalUrl,
      status: res.statusCode,
      duration,
      ip: req.ip,
      userAgent: req.get('user-agent'),
      contentLength: res.get('content-length') || 0
    });
  });

  next();
};

// Handle uncaught exceptions and promise rejections
process.on('uncaughtException', (error) => {
  logger.error('Uncaught exception:', error);
  process.exit(1);
});

process.on('unhandledRejection', (reason) => {
  logger.error('Unhandled promise rejection:', reason);
});

module.exports = logger;