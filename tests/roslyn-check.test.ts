import { describe, it, expect } from 'vitest';
import { checkRoslynLanguageServer } from '../src/roslyn-check.js';

describe('roslyn-check', () => {
  it('should check for roslyn-language-server', () => {
    const result = checkRoslynLanguageServer();
    // This will be false in CI, but the function should execute without errors
    expect(typeof result).toBe('boolean');
  });
});
