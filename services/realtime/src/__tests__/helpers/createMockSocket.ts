import { AuthenticatedSocket } from '../../types';

export function createMockSocket(overrides: Partial<AuthenticatedSocket & { alias?: string; screenPeerId?: string }> = {}): jest.Mocked<AuthenticatedSocket> & { alias?: string; screenPeerId?: string } {
  const toReturn = { emit: jest.fn() };
  return {
    id: 'socket-001',
    userId: 'user-001',
    username: 'testuser',
    token: 'mock-token',
    peerId: 'peer-001',
    roomId: undefined,
    emit: jest.fn(),
    join: jest.fn(),
    leave: jest.fn(),
    to: jest.fn().mockReturnValue(toReturn),
    ...overrides,
  } as unknown as jest.Mocked<AuthenticatedSocket> & { alias?: string; screenPeerId?: string };
}
