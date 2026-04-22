jest.mock('child_process', () => require('../__mocks__/child_process'));

import { AVPipeline } from '../pipelines/AVPipeline';
import { spawn } from '../__mocks__/child_process';

beforeEach(() => {
  jest.clearAllMocks();
});

describe('AVPipeline start()', () => {
  it('directs yt-dlp temp fragment files into /tmp', () => {
    const pipeline = new AVPipeline('https://www.youtube.com/watch?v=test');
    pipeline.start();

    expect(spawn).toHaveBeenCalledTimes(1);
    const ytdlpArgs = (spawn as jest.Mock).mock.calls[0][1] as string[];
    expect(ytdlpArgs).toContain('--paths');
    expect(ytdlpArgs).toContain('temp:/tmp');

    pipeline.stop();
  });
});
