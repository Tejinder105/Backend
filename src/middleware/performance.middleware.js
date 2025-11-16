/**
 * Performance Monitoring Middleware
 * Tracks response times and logs slow requests
 */

const performanceMonitor = (req, res, next) => {
  const startTime = Date.now();
  const requestPath = req.path;
  const requestMethod = req.method;

  // Store original end function
  const originalEnd = res.end;

  // Override end function to capture response time
  res.end = function (...args) {
    const duration = Date.now() - startTime;
    const statusCode = res.statusCode;

    // Log performance data
    const logData = {
      method: requestMethod,
      path: requestPath,
      statusCode,
      duration: `${duration}ms`,
      timestamp: new Date().toISOString(),
    };

    // Warn on slow requests (> 1 second)
    if (duration > 1000) {
      console.warn('⚠️  [SLOW REQUEST]', logData);
    } else if (duration > 500) {
      console.log('🐌 [Moderate]', logData);
    } else {
      console.log('⚡ [Fast]', logData);
    }

    // Call original end function
    originalEnd.apply(res, args);
  };

  next();
};

/**
 * Performance metrics aggregator
 * Tracks average response times and request counts
 */
class PerformanceMetrics {
  constructor() {
    this.metrics = new Map();
  }

  recordRequest(path, duration) {
    if (!this.metrics.has(path)) {
      this.metrics.set(path, {
        count: 0,
        totalDuration: 0,
        minDuration: duration,
        maxDuration: duration,
      });
    }

    const metric = this.metrics.get(path);
    metric.count++;
    metric.totalDuration += duration;
    metric.minDuration = Math.min(metric.minDuration, duration);
    metric.maxDuration = Math.max(metric.maxDuration, duration);
  }

  getMetrics(path) {
    const metric = this.metrics.get(path);
    if (!metric) return null;

    return {
      path,
      count: metric.count,
      avgDuration: Math.round(metric.totalDuration / metric.count),
      minDuration: metric.minDuration,
      maxDuration: metric.maxDuration,
    };
  }

  getAllMetrics() {
    const results = [];
    for (const [path, data] of this.metrics.entries()) {
      results.push({
        path,
        count: data.count,
        avgDuration: Math.round(data.totalDuration / data.count),
        minDuration: data.minDuration,
        maxDuration: data.maxDuration,
      });
    }
    return results.sort((a, b) => b.avgDuration - a.avgDuration);
  }

  reset() {
    this.metrics.clear();
  }
}

const metrics = new PerformanceMetrics();

// Enhanced performance monitor with metrics tracking
const performanceMonitorWithMetrics = (req, res, next) => {
  const startTime = Date.now();
  const requestPath = req.path;
  const requestMethod = req.method;

  const originalEnd = res.end;

  res.end = function (...args) {
    const duration = Date.now() - startTime;
    const statusCode = res.statusCode;

    // Record metrics
    metrics.recordRequest(requestPath, duration);

    // Log performance data
    const logData = {
      method: requestMethod,
      path: requestPath,
      statusCode,
      duration: `${duration}ms`,
    };

    if (duration > 1000) {
      console.warn('⚠️  [SLOW REQUEST]', logData);
    } else if (duration > 500) {
      console.log('🐌 [Moderate]', logData);
    } else if (process.env.NODE_ENV === 'development') {
      console.log('⚡ [Fast]', logData);
    }

    originalEnd.apply(res, args);
  };

  next();
};

export { performanceMonitor, performanceMonitorWithMetrics, metrics };
export default performanceMonitor;
