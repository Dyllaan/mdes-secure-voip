#!/usr/bin/env node

const Database = require('better-sqlite3');
const bcrypt = require('bcrypt');
const readline = require('readline');

const db = new Database('auth.db');

const rl = readline.createInterface({
  input: process.stdin,
  output: process.stdout
});

function question(prompt) {
  return new Promise((resolve) => {
    rl.question(prompt, resolve);
  });
}

async function addUser() {
  console.log('\n Add New User\n');
  
  const username = await question('Username: ');
  const password = await question('Password: ');
  const email = await question('Email (optional): ');
  const displayName = await question('Display Name: ');
  const role = await question('Role (user/admin) [user]: ') || 'user';

  try {
    const passwordHash = await bcrypt.hash(password, 10);
    
    const stmt = db.prepare(`
      INSERT INTO users (username, password_hash)
      VALUES (?, ?, ?, ?, ?)
    `);
    
    const result = stmt.run(username, passwordHash, email || null, displayName, role);
    
    console.log(`\nUser created successfully! (ID: ${result.lastInsertRowid})\n`);
  } catch (error) {
    if (error.message.includes('UNIQUE constraint failed')) {
      console.log('\nError: Username or email already exists\n');
    } else {
      console.log('\nError:', error.message, '\n');
    }
  }
}

async function listUsers() {
  console.log('\nAll Users\n');
  
  const users = db.prepare(`
    SELECT id, username, last_login
    FROM users
    ORDER BY id
  `).all();

  if (users.length === 0) {
    console.log('No users found.\n');
    return;
  }

  console.table(users.map(u => ({
    ID: u.id,
    Username: u.username,
    Active: u.is_active ? 'Yes' : 'No',
    'Last Login': u.last_login || 'Never'
  })));
  console.log();
}

async function updatePassword() {
  console.log('\n Update User Password\n');
  
  const username = await question('Username: ');
  const newPassword = await question('New Password: ');

  try {
    const user = db.prepare('SELECT id FROM users WHERE username = ?').get(username);
    
    if (!user) {
      console.log('\nUser not found\n');
      return;
    }

    const passwordHash = await bcrypt.hash(newPassword, 10);
    db.prepare('UPDATE users SET password_hash = ? WHERE id = ?').run(passwordHash, user.id);
    
    // Invalidate refresh tokens
    db.prepare('DELETE FROM refresh_tokens WHERE user_id = ?').run(user.id);
    
    console.log('\nPassword updated successfully!\n');
  } catch (error) {
    console.log('\nError:', error.message, '\n');
  }
}

async function toggleUserStatus() {
  console.log('\n Toggle User Active Status\n');
  
  const username = await question('Username: ');

  try {
    const user = db.prepare('SELECT id, is_active FROM users WHERE username = ?').get(username);
    
    if (!user) {
      console.log('\nUser not found\n');
      return;
    }

    const newStatus = user.is_active ? 0 : 1;
    db.prepare('UPDATE users SET is_active = ? WHERE id = ?').run(newStatus, user.id);
    
    if (!newStatus) {
      db.prepare('DELETE FROM refresh_tokens WHERE user_id = ?').run(user.id);
    }
    
    console.log(`\nUser ${newStatus ? 'activated' : 'deactivated'} successfully!\n`);
  } catch (error) {
    console.log('\nError:', error.message, '\n');
  }
}

async function deleteUser() {
  console.log('\n️  Delete User\n');
  
  const username = await question('Username: ');
  const confirm = await question(`Are you sure you want to delete user "${username}"? (yes/no): `);

  if (confirm.toLowerCase() !== 'yes') {
    console.log('\nCancelled\n');
    return;
  }

  try {
    const result = db.prepare('DELETE FROM users WHERE username = ?').run(username);
    
    if (result.changes === 0) {
      console.log('\nUser not found\n');
    } else {
      console.log('\nUser deleted successfully!\n');
    }
  } catch (error) {
    console.log('\nError:', error.message, '\n');
  }
}

async function showStats() {
  console.log('\n Database Statistics\n');
  
  const stats = {
    totalUsers: db.prepare('SELECT COUNT(*) as count FROM users').get().count,
    activeTokens: db.prepare('SELECT COUNT(*) as count FROM refresh_tokens WHERE expires_at > CURRENT_TIMESTAMP').get().count,
    expiredTokens: db.prepare('SELECT COUNT(*) as count FROM refresh_tokens WHERE expires_at <= CURRENT_TIMESTAMP').get().count
  };

  console.log(`Total Users: ${stats.totalUsers}`);
  console.log(`Active Tokens: ${stats.activeTokens}`);
  console.log(`Expired Tokens: ${stats.expiredTokens}\n`);
}

async function cleanupTokens() {
  console.log('\nCleanup Expired Tokens\n');
  
  const result = db.prepare('DELETE FROM refresh_tokens WHERE expires_at < CURRENT_TIMESTAMP').run();
  console.log(`Removed ${result.changes} expired tokens\n`);
}

async function mainMenu() {
  console.log('\n╔════════════════════════════════════╗');
  console.log('║   Auth Service User Management    ║');
  console.log('╚════════════════════════════════════╝\n');
  console.log('1. List all users');
  console.log('2. Add new user');
  console.log('3. Update user password');
  console.log('4. Toggle user active status');
  console.log('5. Delete user');
  console.log('6. Show statistics');
  console.log('7. Cleanup expired tokens');
  console.log('0. Exit\n');

  const choice = await question('Choose an option: ');

  switch (choice.trim()) {
    case '1':
      await listUsers();
      break;
    case '2':
      await addUser();
      break;
    case '3':
      await updatePassword();
      break;
    case '4':
      await toggleUserStatus();
      break;
    case '5':
      await deleteUser();
      break;
    case '6':
      await showStats();
      break;
    case '7':
      await cleanupTokens();
      break;
    case '0':
      console.log('\n Goodbye!\n');
      rl.close();
      db.close();
      process.exit(0);
      return;
    default:
      console.log('\nInvalid option\n');
  }

  await mainMenu();
}

// Start
console.clear();
mainMenu().catch(error => {
  console.error('Error:', error);
  rl.close();
  db.close();
  process.exit(1);
});