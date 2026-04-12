import { isValidRoomId } from '../../utils/validate';

const MAX = 60;

describe('isValidRoomId', () => {
  it('should return true for a simple alphanumeric roomId', () => {
    expect(isValidRoomId('abc123', MAX)).toBe(true);
  });

  it('should return true for a roomId containing underscores', () => {
    expect(isValidRoomId('room_1', MAX)).toBe(true);
  });

  it('should return true for a roomId containing hyphens', () => {
    expect(isValidRoomId('room-1', MAX)).toBe(true);
  });

  it('should return true for a single character', () => {
    expect(isValidRoomId('a', MAX)).toBe(true);
  });

  it('should return true for a roomId exactly at maxLen', () => {
    expect(isValidRoomId('a'.repeat(MAX), MAX)).toBe(true);
  });

  it('should return false for an empty string', () => {
    expect(isValidRoomId('', MAX)).toBe(false);
  });

  it('should return false for a roomId exceeding maxLen by 1', () => {
    expect(isValidRoomId('a'.repeat(MAX + 1), MAX)).toBe(false);
  });

  it('should return false for a roomId containing spaces', () => {
    expect(isValidRoomId('room id', MAX)).toBe(false);
  });

  it('should return false for a roomId containing a forward slash', () => {
    expect(isValidRoomId('room/id', MAX)).toBe(false);
  });

  it('should return false for a roomId containing a dot', () => {
    expect(isValidRoomId('room.id', MAX)).toBe(false);
  });

  it('should return false for a roomId containing @', () => {
    expect(isValidRoomId('room@id', MAX)).toBe(false);
  });

  it('should return false for a roomId containing #', () => {
    expect(isValidRoomId('room#id', MAX)).toBe(false);
  });

  it('should return false for a roomId containing !', () => {
    expect(isValidRoomId('room!id', MAX)).toBe(false);
  });
});
