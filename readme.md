# DataForge Analytics 🔍

[![MIT License](https://img.shields.io/badge/license-MIT-blue.svg)](https://opensource.org/licenses/MIT)
[![Node.js CI](https://github.com/yourusername/dataforge-analytics/actions/workflows/node.js.yml/badge.svg)](https://github.com/yourusername/dataforge-analytics/actions)

Privacy-focused analytics solution with server-side logging and client-side tracking capabilities.

## Features

- 🛡️ Privacy-first approach with cookie consent tracking
- 📊 Pageview and event tracking
- ⚡ Real-time performance metrics
- 📈 PostgreSQL-based storage
- 🔒 Secure middleware with rate limiting and helmet
- 📝 Comprehensive logging with Winston
- 🩺 Health check endpoints

## Installation

```bash
npm install dataforge-analytics
# or
yarn add dataforge-analytics
```

## Configuration

Set these environment variables in your `.env` file:

```env
DATABASE_URL=postgres://user:password@host:port/database
NODE_ENV=production
LOG_DIR=/var/log/dataforge
SERVICE_NAME=my-web-app
```

## Usage

### Server-side Setup

```javascript
const express = require('express');
const DataForge = require('dataforge-analytics');

const app = express();

// Initialize DataForge analytics
DataForge(app);

app.listen(3000, () => {
  console.log('Server running on port 3000');
});
```

### Client-side Integration

Add this script to your HTML:

```html
<script src="/dataforge/analytics/static/v1/dataforge-client.js"></script>
```

### Event Tracking

Track events using HTML data attributes:

```html
<button data-track-event 
        data-event-name="download"
        data-event-category="engagement">
  Download Now
</button>
```

Or track events programmatically:

```javascript
window.trackEvent('purchase', 'ecommerce', {
  product_id: '123',
  value: 49.99
});
```

## API Endpoints

| Endpoint                      | Description                     |
|-------------------------------|---------------------------------|
| `/dataforge/health`           | System health status            |
| `/dataforge/analytics/api/v1` | Analytics data ingestion endpoint|

## Logging

Logs are stored in daily rotated files:

```
logs/
  error-2023-01-01.log
  combined-2023-01-01.log
  exceptions-2023-01-01.log
```

## Environment Variables

| Variable        | Default           | Description                |
|-----------------|-------------------|----------------------------|
| DATABASE_URL    | (required)        | PostgreSQL connection URL  |
| LOG_DIR         | ./logs            | Log storage directory      |
| SERVICE_NAME    | dataforge-analytics| Service identifier        |

## Contributing

1. Fork the repository
2. Create your feature branch (`git checkout -b feature/amazing-feature`)
3. Commit your changes (`git commit -m 'Add amazing feature'`)
4. Push to the branch (`git push origin feature/amazing-feature`)
5. Open a Pull Request

## License

MIT © [Tetrachrome Studios](https://tetrachromestudios.com)
