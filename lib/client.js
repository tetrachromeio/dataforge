(function() {
  'use strict';

  // Configuration Constants
  const COOKIE_CONFIG = {
      name: 'cookies_accepted',
      value: 'true',
      path: '/',
      maxAge: 31536000 // 1 year
  };
  
  const API_ENDPOINT = '/dataforge/analytics/api/v1';
  const NAVIGATION_TIMING_FALLBACK_LIMIT = 3600; // 3.6 seconds in ms

  // Feature Detection
  const supportsPerformance = () => 
      window.performance && window.performance.getEntriesByType;

  // Cookie Utilities
  const getCookie = name => {
      const value = document.cookie
          .split('; ')
          .find(row => row.startsWith(`${name}=`))
          ?.split('=')[1];
      return value ? decodeURIComponent(value) : null;
  };

  // Analytics Utilities
  const getNavigationTiming = () => {
      if (!supportsPerformance()) return null;
      
      try {
          const [navigationEntry] = window.performance.getEntriesByType('navigation');
          return navigationEntry || null;
      } catch (e) {
          console.warn('Performance API error:', e);
          return null;
      }
  };

  const getLoadTime = () => {
      const navigationEntry = getNavigationTiming();
      
      if (navigationEntry) {
          return navigationEntry.domContentLoadedEventEnd - navigationEntry.startTime;
      }

      // Fallback for browsers without Navigation Timing API
      if (window.performance.timing) {
          const timing = window.performance.timing;
          return timing.domContentLoadedEventEnd - timing.navigationStart;
      }

      return null;
  };

  // Data Transport
  const sendData = (data, useBeacon = false) => {
      const payload = JSON.stringify(data);
      
      if (useBeacon && navigator.sendBeacon) {
          navigator.sendBeacon(API_ENDPOINT, payload);
      } else {
          fetch(API_ENDPOINT, {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: payload,
              keepalive: true // Ensures request completes even if page unloads
          }).catch(error => console.error('Analytics error:', error));
      }
  };

  // Consent Check
  const hasConsent = () => 
      getCookie(COOKIE_CONFIG.name) === COOKIE_CONFIG.value;

  // Core Tracking
  const trackPageview = () => {
      const trackLoad = () => {
          const loadTime = getLoadTime();
          
          // Validate load time measurement
          if (loadTime && loadTime > NAVIGATION_TIMING_FALLBACK_LIMIT) {
              console.warn('Suspicious load time measurement:', loadTime);
          }

          sendData({
              type: 'pageview',
              url: window.location.href,
              user_agent: navigator.userAgent,
              page_load_time: loadTime,
              screen_resolution: `${screen.width}x${screen.height}`,
              timestamp: new Date().toISOString()
          });
      };

      // Use requestIdleCallback if available for non-critical load timing
      if ('requestIdleCallback' in window) {
          window.requestIdleCallback(trackLoad, { timeout: 2000 });
      } else {
          window.addEventListener('load', trackLoad, { once: true });
      }
  };

  const trackEvent = (eventName, eventCategory, eventLabel = '', payload = {}) => {
      sendData({
          type: 'event',
          event_name: eventName,
          event_category: eventCategory,
          event_label: eventLabel.substring(0, 500), // Prevent oversized payloads
          url: window.location.href,
          user_agent: navigator.userAgent,
          timestamp: new Date().toISOString(),
          ...payload
      });
  };

  // Consent-based Execution
  if (!hasConsent()) {
      sendData({ 
          type: 'pageview-anon', 
          url: window.location.href,
          timestamp: new Date().toISOString()
      }, true);
      return;
  }

  // Main Execution
  try {
      // Pageview Tracking
      trackPageview();

      // Event Tracking
      document.addEventListener('DOMContentLoaded', () => {
          document.body.addEventListener('click', event => {
              const target = event.target.closest('[data-track-event]');
              if (!target) return;

              const eventName = target.dataset.eventName || 'click';
              const category = target.dataset.eventCategory || 'interaction';
              trackEvent(
                  eventName,
                  category,
                  target.textContent?.trim().substring(0, 200),
                  {
                      element_id: target.id || 'none',
                      element_type: target.tagName,
                      x: `${event.clientX}:${event.clientY}`,
                      page_x: `${event.pageX}:${event.pageY}`
                  }
              );
          });
      });

      // Session Tracking
      window.addEventListener('visibilitychange', () => {
          if (document.visibilityState === 'hidden') {
              sendData({
                  type: 'page_visibility',
                  state: 'hidden',
                  url: window.location.href
              }, true);
          }
      });

      window.addEventListener('beforeunload', () => {
          sendData({
              type: 'page_exit',
              url: window.location.href,
              time_on_page: performance.now()
          }, true);
      });

  } catch (error) {
      console.error('Analytics initialization error:', error);
  }
})();