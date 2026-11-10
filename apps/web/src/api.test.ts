import { describe, expect, it } from 'vitest';
import { ApiError, explain } from './api';

describe('explain', () => {
  it('shows scrubbed clone text and plain sentences for git failures', () => {
    expect(explain(new ApiError(400, 'clone_failed', 'fatal: repository not found'))).toBe('fatal: repository not found');
    expect(explain(new ApiError(409, 'dirty'))).toBe('This repo has local changes, so it was left as it is.');
    expect(explain(new ApiError(400, 'too_large'))).toBe('That repo is larger than 500 MB, so it was not kept.');
    expect(explain(new ApiError(400, 'invalid_repo'))).toBe('Use owner/repo or a https://github.com/owner/repo URL.');
    expect(explain(new ApiError(409, 'exists'))).toBe('That project already exists.');
  });
});
