import { EventEmitter } from 'events';
import { Readable, Writable } from 'stream';

export function createMockProcess() {
  const proc = new EventEmitter() as any;
  proc.stdout = new Readable({ read() {} });
  proc.stderr = new Readable({ read() {} });
  proc.stdin  = new Writable({ write(_chunk: any, _encoding: any, cb: () => void) { cb(); } });
  proc.kill   = jest.fn();
  proc.pid    = 12345;
  return proc;
}

export const spawn = jest.fn().mockImplementation(() => createMockProcess());
