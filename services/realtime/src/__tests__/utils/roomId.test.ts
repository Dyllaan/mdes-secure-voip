import { generateRoomId } from '../../utils/roomId';

describe('generateRoomId', () => {
  it('should return a string', () => {
    expect(typeof generateRoomId()).toBe('string');
  });

  it('should only contain base64url-safe characters', () => {
    for (let i = 0; i < 100; i++) {
      expect(generateRoomId()).toMatch(/^[A-Za-z0-9_-]+$/);
    }
  });

  it('should not contain padding characters (=, +, /)', () => {
    for (let i = 0; i < 100; i++) {
      const id = generateRoomId();
      expect(id).not.toContain('=');
      expect(id).not.toContain('+');
      expect(id).not.toContain('/');
    }
  });

  it('should generate unique values across 1000 calls (probabilistic)', () => {
    const ids = new Set(Array.from({ length: 1000 }, () => generateRoomId()));
    expect(ids.size).toBe(1000);
  });
});
