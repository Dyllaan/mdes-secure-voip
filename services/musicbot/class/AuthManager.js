const axios = require('axios');

class AuthManager {
  constructor(config) {
    this.config = config;
    this.accessToken = null;
    this.refreshToken = null;
    this.tokenRefreshTimer = null;
  }

  async login(retryCount = 0, maxRetries = 100) {
    try {
      if (retryCount > 0) {
        console.log(`Authentication attempt ${retryCount + 1}/${maxRetries}...`);
      } else {
        console.log(`Authenticating as ${this.config.username}...`);
      }
      
      const response = await axios.post(`${this.config.authServiceUrl}/login`, {
        username: this.config.username,
        password: this.config.password
      });

      this.accessToken = response.data.accessToken;
      this.refreshToken = response.data.refreshToken;

      console.log(`✓ Successfully authenticated as ${this.config.username}`);

      const refreshInterval = (23 * 60 + 55) * 60 * 1000;
      this.scheduleTokenRefresh(refreshInterval);

      return true;
    } catch (error) {
      const errorMsg = error.response?.data?.error || error.message;
      
      // Check if it's a rate limit error
      if (errorMsg.includes('Too many login attempts')) {
        if (retryCount < maxRetries) {
          // First retry: wait 30 seconds, then exponential increase
          // 30s, 60s, 120s, 240s, etc. (capped at 10 minutes)
          const baseWait = 30000; // 30 seconds
          const waitTime = Math.min(baseWait * Math.pow(2, retryCount), 600000); // Max 10 minutes
          
          console.log(`⚠ Rate limited. Waiting ${waitTime / 1000} seconds before retry... (attempt ${retryCount + 1}/${maxRetries})`);
          
          await new Promise(resolve => setTimeout(resolve, waitTime));
          return this.login(retryCount + 1, maxRetries);
        } else {
          console.error(`✗ Failed to authenticate after ${maxRetries} attempts`);
          throw new Error('Max authentication retries exceeded');
        }
      }
      
      console.error('Authentication failed:', errorMsg);
      throw new Error('Failed to authenticate with auth service: ' + errorMsg);
    }
  }

  scheduleTokenRefresh(interval) {
    if (this.tokenRefreshTimer) {
      clearTimeout(this.tokenRefreshTimer);
    }

    this.tokenRefreshTimer = setTimeout(async () => {
      try {
        await this.refreshAccessToken();
      } catch (error) {
        console.error('Token refresh failed, attempting re-login...');
        await this.login();
      }
    }, interval);
  }

  async refreshAccessToken() {
    try {
      console.log('Refreshing access token...');
      
      const response = await axios.post(`${this.config.authServiceUrl}/refresh`, {
        refreshToken: this.refreshToken
      });

      this.accessToken = response.data.accessToken;
      console.log('✓ Access token refreshed');

      const refreshInterval = (23 * 60 + 55) * 60 * 1000;
      this.scheduleTokenRefresh(refreshInterval);

      return true;
    } catch (error) {
      console.error('Token refresh error:', error.response?.data || error.message);
      throw error;
    }
  }

  async verifyToken() {
    if (!this.accessToken) return false;

    try {
      const response = await axios.post(`${this.config.authServiceUrl}/verify`, {
        token: this.accessToken
      });

      return response.data.valid;
    } catch (error) {
      return false;
    }
  }

  getAuthHeader() {
    return this.accessToken ? `Bearer ${this.accessToken}` : null;
  }

  async logout() {
    if (this.tokenRefreshTimer) {
      clearTimeout(this.tokenRefreshTimer);
    }

    try {
      if (this.refreshToken) {
        await axios.post(
          `${this.config.authServiceUrl}/logout`,
          { refreshToken: this.refreshToken },
          { headers: { Authorization: this.getAuthHeader() } }
        );
      }
    } catch (error) {
      console.error('Logout error:', error.message);
    }

    this.accessToken = null;
    this.refreshToken = null;
  }
}

module.exports = AuthManager;