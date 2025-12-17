/**
 * IndexedDB wrapper for Signal Protocol Store
 * Provides persistent storage for keys and sessions
 */
export class SignalDirectory {
  private dbName: string = 'SignalProtocolDB';
  private dbVersion: number = 1;
  private storeName: string = 'signal-store';
  private db: IDBDatabase | null = null;

  constructor() {
    this.initDB();
  }

  /**
   * Initialize IndexedDB
   */
  private async initDB(): Promise<void> {
    return new Promise((resolve, reject) => {
      const request = indexedDB.open(this.dbName, this.dbVersion);

      request.onerror = () => {
        console.error('Failed to open IndexedDB:', request.error);
        reject(request.error);
      };

      request.onsuccess = () => {
        this.db = request.result;
        console.log('IndexedDB opened successfully');
        resolve();
      };

      request.onupgradeneeded = (event: IDBVersionChangeEvent) => {
        const db = (event.target as IDBOpenDBRequest).result;
        
        // Create object store if it doesn't exist
        if (!db.objectStoreNames.contains(this.storeName)) {
          db.createObjectStore(this.storeName);
          console.log('IndexedDB object store created');
        }
      };
    });
  }

  /**
   * Ensure database is ready
   */
  private async ensureDB(): Promise<IDBDatabase> {
    if (this.db) {
      return this.db;
    }
    
    await this.initDB();
    
    if (!this.db) {
      throw new Error('Failed to initialize database');
    }
    
    return this.db;
  }

  /**
   * Store a value
   */
  async put(key: string, value: any): Promise<void> {
    const db = await this.ensureDB();
    
    return new Promise((resolve, reject) => {
      const transaction = db.transaction([this.storeName], 'readwrite');
      const store = transaction.objectStore(this.storeName);
      const request = store.put(value, key);

      request.onsuccess = () => resolve();
      request.onerror = () => {
        console.error('IndexedDB put error:', request.error);
        reject(request.error);
      };
    });
  }

  /**
   * Get a value
   */
  async get(key: string): Promise<any> {
    const db = await this.ensureDB();
    
    return new Promise((resolve, reject) => {
      const transaction = db.transaction([this.storeName], 'readonly');
      const store = transaction.objectStore(this.storeName);
      const request = store.get(key);

      request.onsuccess = () => resolve(request.result);
      request.onerror = () => {
        console.error('IndexedDB get error:', request.error);
        reject(request.error);
      };
    });
  }

  /**
   * Remove a value
   */
  async remove(key: string): Promise<void> {
    const db = await this.ensureDB();
    
    return new Promise((resolve, reject) => {
      const transaction = db.transaction([this.storeName], 'readwrite');
      const store = transaction.objectStore(this.storeName);
      const request = store.delete(key);

      request.onsuccess = () => resolve();
      request.onerror = () => {
        console.error('IndexedDB remove error:', request.error);
        reject(request.error);
      };
    });
  }

  /**
   * Clear all data
   */
  async clear(): Promise<void> {
    const db = await this.ensureDB();
    
    return new Promise((resolve, reject) => {
      const transaction = db.transaction([this.storeName], 'readwrite');
      const store = transaction.objectStore(this.storeName);
      const request = store.clear();

      request.onsuccess = () => {
        console.log('IndexedDB cleared');
        resolve();
      };
      request.onerror = () => {
        console.error('IndexedDB clear error:', request.error);
        reject(request.error);
      };
    });
  }

  /**
   * Get all keys
   */
  async getAllKeys(): Promise<string[]> {
    const db = await this.ensureDB();
    
    return new Promise((resolve, reject) => {
      const transaction = db.transaction([this.storeName], 'readonly');
      const store = transaction.objectStore(this.storeName);
      const request = store.getAllKeys();

      request.onsuccess = () => resolve(request.result as string[]);
      request.onerror = () => {
        console.error('IndexedDB getAllKeys error:', request.error);
        reject(request.error);
      };
    });
  }

  /**
   * Close the database connection
   */
  close(): void {
    if (this.db) {
      this.db.close();
      this.db = null;
      console.log('IndexedDB connection closed');
    }
  }
}