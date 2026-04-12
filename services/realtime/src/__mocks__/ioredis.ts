const RedisMock = jest.fn().mockImplementation(() => ({
  get: jest.fn().mockResolvedValue(null),
  set: jest.fn().mockResolvedValue('OK'),
  del: jest.fn().mockResolvedValue(1),
  quit: jest.fn().mockResolvedValue(undefined),
  on: jest.fn(),
  status: 'ready',
}));

export default RedisMock;
