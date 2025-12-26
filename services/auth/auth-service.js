const express = require('express');
const jwt = require('jsonwebtoken');
const bcrypt = require('bcrypt');
const sqlite3 = require('sqlite3').verbose();
const cors = require('cors');
const helmet = require('helmet');
const rateLimit = require('express-rate-limit');

require('dotenv').config({
  path: process.env.NODE_ENV === 'docker' ? '.env.docker' : '.env.local'
});

const app = express();
const db = new sqlite3.Database('auth.db');

// Configuration
const config = {
  port: process.env.AUTH_PORT || 3003,
  jwt: {
    secret: process.env.JWT_SECRET || (() => {
      throw new Error('JWT_SECRET environment variable is required');
    })(),
    expiresIn: process.env.JWT_EXPIRES_IN || '24h',
    refreshExpiresIn: '7d'
  },
  cors: {
    origin: process.env.ALLOWED_ORIGINS?.split(',') || [
      "http://localhost:3000",
      "http://localhost:5173",
      "http://localhost:5174",
      "http://localhost:8080",
      "http://127.0.0.1:3000",
      "http://127.0.0.1:5173",
      "http://127.0.0.1:5174",
      "http://127.0.0.1:8080"
    ],
    credentials: true,
    methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
    allowedHeaders: ['Content-Type', 'Authorization'],
    exposedHeaders: ['Content-Type', 'Authorization']
  }
};

// Middleware
app.use(helmet());
app.use(cors(config.cors));
app.use(express.json({ limit: '1mb' }));

// Handle preflight requests
app.options('*', cors(config.cors));

// Rate limiting for login attempts
const loginLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 5, // 5 attempts per window
  message: { error: 'Too many login attempts, please try again later' },
  standardHeaders: true,
  legacyHeaders: false
});

// Promisify database methods
function dbRun(sql, params = []) {
  return new Promise((resolve, reject) => {
    db.run(sql, params, function(err) {
      if (err) reject(err);
      else resolve(this);
    });
  });
}

function dbGet(sql, params = []) {
  return new Promise((resolve, reject) => {
    db.get(sql, params, (err, row) => {
      if (err) reject(err);
      else resolve(row);
    });
  });
}

function dbAll(sql, params = []) {
  return new Promise((resolve, reject) => {
    db.all(sql, params, (err, rows) => {
      if (err) reject(err);
      else resolve(rows);
    });
  });
}

// Initialize database schema
async function initializeDatabase() {
  return new Promise((resolve, reject) => {
    db.serialize(() => {
      db.run(`
        CREATE TABLE IF NOT EXISTS users (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          username TEXT UNIQUE NOT NULL,
          password_hash TEXT NOT NULL,
          email TEXT UNIQUE,
          display_name TEXT,
          role TEXT DEFAULT 'user',
          is_active INTEGER DEFAULT 1,
          created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
          last_login DATETIME
        )
      `);

      db.run(`
        CREATE TABLE IF NOT EXISTS refresh_tokens (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          user_id INTEGER NOT NULL,
          token TEXT UNIQUE NOT NULL,
          expires_at DATETIME NOT NULL,
          created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
          FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
        )
      `);

      db.run(`CREATE INDEX IF NOT EXISTS idx_refresh_tokens_token ON refresh_tokens(token)`);
      
      db.run(`CREATE INDEX IF NOT EXISTS idx_refresh_tokens_user_id ON refresh_tokens(user_id)`, (err) => {
        if (err) reject(err);
        else {
          console.log('Database initialized');
          resolve();
        }
      });
    });
  });
}

// Seed predefined users for dev only
async function seedUsers() {
  const predefinedUsers = [
    {
      username: 'louis',
      password: '?8D~)%4Uk;6s',
      email: 'louis@example.com',
      displayName: 'Louis',
      role: 'admin'
    },
    {
      username: 'james',
      password: 'p@ssW0rd!23',
      email: 'james@example.com',
      displayName: 'James',
      role: 'user'
    }
  ];

  for (const user of predefinedUsers) {
    try {
      const exists = await dbGet('SELECT id FROM users WHERE username = ?', [user.username]);
      
      if (!exists) {
        const passwordHash = await bcrypt.hash(user.password, 10);
        await dbRun(
          'INSERT INTO users (username, password_hash, email, display_name, role) VALUES (?, ?, ?, ?, ?)',
          [user.username, passwordHash, user.email, user.displayName, user.role]
        );
        console.log(`Created user: ${user.username}`);
      }
    } catch (error) {
      console.error(`Error seeding user ${user.username}:`, error.message);
    }
  }
}

// JWT Helper functions
function generateAccessToken(user) {
  return jwt.sign(
    {
      userId: user.id.toString(),
      username: user.username,
      role: user.role
    },
    config.jwt.secret,
    { expiresIn: config.jwt.expiresIn }
  );
}

function generateRefreshToken(user) {
  return jwt.sign(
    {
      userId: user.id.toString(),
      type: 'refresh'
    },
    config.jwt.secret,
    { expiresIn: config.jwt.refreshExpiresIn }
  );
}

function verifyToken(token) {
  try {
    return jwt.verify(token, config.jwt.secret);
  } catch (err) {
    return null;
  }
}

// Middleware to verify JWT
function authenticateToken(req, res, next) {
  const authHeader = req.headers.authorization;
  const token = authHeader && authHeader.split(' ')[1]; // Bearer TOKEN

  if (!token) {
    return res.status(401).json({ error: 'Access token required' });
  }

  const decoded = verifyToken(token);
  if (!decoded) {
    return res.status(403).json({ error: 'Invalid or expired token' });
  }

  req.user = decoded;
  next();
}

// Health check
app.get('/health', (req, res) => {
  res.json({ 
    status: 'healthy',
    service: 'auth',
    timestamp: new Date().toISOString()
  });
});

// Login
app.post('/login', loginLimiter, async (req, res) => {
  const { username, password } = req.body;

  if (!username || !password) {
    return res.status(400).json({ error: 'Username and password required' });
  }

  try {
    // Get user from database
    const user = await dbGet('SELECT * FROM users WHERE username = ? AND is_active = 1', [username]);

    if (!user) {
      return res.status(401).json({ error: 'Invalid credentials' });
    }

    // Verify password
    const validPassword = await bcrypt.compare(password, user.password_hash);
    if (!validPassword) {
      return res.status(401).json({ error: 'Invalid credentials' });
    }

    // Update last login
    await dbRun('UPDATE users SET last_login = CURRENT_TIMESTAMP WHERE id = ?', [user.id]);

    // Generate tokens
    const accessToken = generateAccessToken(user);
    const refreshToken = generateRefreshToken(user);

    // Store refresh token
    const expiresAt = new Date();
    expiresAt.setDate(expiresAt.getDate() + 7); // 7 days
    
    await dbRun(
      'INSERT INTO refresh_tokens (user_id, token, expires_at) VALUES (?, ?, ?)',
      [user.id, refreshToken, expiresAt.toISOString()]
    );

    // Clean up old refresh tokens for this user
    await dbRun('DELETE FROM refresh_tokens WHERE user_id = ? AND expires_at < CURRENT_TIMESTAMP', [user.id]);

    console.log(`User logged in: ${username}`);

    res.json({
      accessToken,
      refreshToken,
      user: {
        id: user.id,
        username: user.username,
        displayName: user.display_name,
        email: user.email,
        role: user.role
      }
    });

  } catch (error) {
    console.error('Login error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// Refresh access token
app.post('/refresh', async (req, res) => {
  const { refreshToken } = req.body;

  if (!refreshToken) {
    return res.status(400).json({ error: 'Refresh token required' });
  }

  try {
    // Verify refresh token
    const decoded = verifyToken(refreshToken);
    if (!decoded || decoded.type !== 'refresh') {
      return res.status(403).json({ error: 'Invalid refresh token' });
    }

    // Check if refresh token exists in database
    const storedToken = await dbGet(`
      SELECT rt.*, u.id as user_id, u.username, u.role
      FROM refresh_tokens rt
      JOIN users u ON rt.user_id = u.id
      WHERE rt.token = ? AND rt.expires_at > CURRENT_TIMESTAMP AND u.is_active = 1
    `, [refreshToken]);

    if (!storedToken) {
      return res.status(403).json({ error: 'Invalid or expired refresh token' });
    }

    // Generate new access token
    const accessToken = generateAccessToken({
      id: storedToken.user_id,
      username: storedToken.username,
      role: storedToken.role
    });

    res.json({ accessToken });

  } catch (error) {
    console.error('Refresh error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// Logout
app.post('/logout', authenticateToken, async (req, res) => {
  const { refreshToken } = req.body;

  if (refreshToken) {
    await dbRun('DELETE FROM refresh_tokens WHERE token = ?', [refreshToken]);
  }

  res.json({ message: 'Logged out successfully' });
});

// Verify token (for other services)
app.post('/verify', async (req, res) => {
  const { token } = req.body;

  if (!token) {
    return res.status(400).json({ error: 'Token required' });
  }

  const decoded = verifyToken(token);
  if (!decoded) {
    return res.status(403).json({ valid: false, error: 'Invalid or expired token' });
  }

  // Get user details
  const user = await dbGet('SELECT id, username, email, display_name, role FROM users WHERE id = ? AND is_active = 1', [decoded.userId]);

  if (!user) {
    return res.status(403).json({ valid: false, error: 'User not found or inactive' });
  }

  res.json({
    valid: true,
    user: {
      id: user.id,
      username: user.username,
      displayName: user.display_name,
      email: user.email,
      role: user.role
    }
  });
});

// Get current user info
app.get('/me', authenticateToken, async (req, res) => {
  const user = await dbGet('SELECT id, username, email, display_name, role, last_login FROM users WHERE id = ?', [req.user.userId]);

  if (!user) {
    return res.status(404).json({ error: 'User not found' });
  }

  res.json({
    id: user.id,
    username: user.username,
    displayName: user.display_name,
    email: user.email,
    role: user.role,
    lastLogin: user.last_login
  });
});

// List all users (admin only)
app.get('/users', authenticateToken, async (req, res) => {
  if (req.user.role !== 'admin') {
    return res.status(403).json({ error: 'Admin access required' });
  }

  const users = await dbAll(`
    SELECT id, username, email, display_name, role, is_active, created_at, last_login
    FROM users
    ORDER BY created_at DESC
  `);

  res.json({ users });
});

// Update user password (admin only)
app.put('/users/:userId/password', authenticateToken, async (req, res) => {
  if (req.user.role !== 'admin') {
    return res.status(403).json({ error: 'Admin access required' });
  }

  const { userId } = req.params;
  const { newPassword } = req.body;

  if (!newPassword || newPassword.length < 6) {
    return res.status(400).json({ error: 'Password must be at least 6 characters' });
  }

  try {
    const passwordHash = await bcrypt.hash(newPassword, 10);
    
    const result = await dbRun('UPDATE users SET password_hash = ? WHERE id = ?', [passwordHash, userId]);

    if (result.changes === 0) {
      return res.status(404).json({ error: 'User not found' });
    }

    // Invalidate all refresh tokens for this user
    await dbRun('DELETE FROM refresh_tokens WHERE user_id = ?', [userId]);

    res.json({ message: 'Password updated successfully' });

  } catch (error) {
    console.error('Password update error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// Toggle user active status (admin only)
app.put('/users/:userId/status', authenticateToken, async (req, res) => {
  if (req.user.role !== 'admin') {
    return res.status(403).json({ error: 'Admin access required' });
  }

  const { userId } = req.params;
  const { isActive } = req.body;

  const result = await dbRun('UPDATE users SET is_active = ? WHERE id = ?', [isActive ? 1 : 0, userId]);

  if (result.changes === 0) {
    return res.status(404).json({ error: 'User not found' });
  }

  // If deactivating, remove all refresh tokens
  if (!isActive) {
    await dbRun('DELETE FROM refresh_tokens WHERE user_id = ?', [userId]);
  }

  res.json({ message: 'User status updated successfully' });
});

// Cleanup expired refresh tokens (run periodically)
async function cleanupExpiredTokens() {
  try {
    const result = await dbRun('DELETE FROM refresh_tokens WHERE expires_at < CURRENT_TIMESTAMP');
    if (result.changes > 0) {
      console.log(`Cleaned up ${result.changes} expired refresh tokens`);
    }
  } catch (error) {
    console.error('Cleanup error:', error);
  }
}

// Error handling
app.use((err, req, res, next) => {
  console.error('Error:', err);
  res.status(500).json({ error: 'Internal server error' });
});

// Start server
async function start() {
  try {
    console.log('Starting Authentication Service...');
    
    await initializeDatabase();
    await seedUsers();

    // Cleanup expired tokens every hour
    setInterval(cleanupExpiredTokens, 60 * 60 * 1000);

    app.listen(config.port, () => {
      console.log(`Auth service running on port ${config.port}`);
      console.log(`Health check: http://localhost:${config.port}/health`);
      console.log('\n Users:');
      console.log('   louis / ?8D~)%4Uk;6s (role: admin)');
      console.log('   james / p@ssW0rd!23 (role: user)\n');
    });

  } catch (error) {
    console.error('Failed to start service:', error);
    process.exit(1);
  }
}

// Graceful shutdown
process.on('SIGINT', () => {
  console.log('\n Shutting down gracefully...');
  db.close(() => {
    console.log('Database connection closed');
    process.exit(0);
  });
});

if (require.main === module) {
  start();
}

module.exports = app;