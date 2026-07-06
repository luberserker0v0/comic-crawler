import { describe, it, expect } from '@jest/globals';
import { renderHook, act } from '@testing-library/react';
import { useLocalStorage } from '../../../src/hooks/useLocalStorage';

describe('useLocalStorage', () => {
  it('should return initial value', () => {
    const { result } = renderHook(() => useLocalStorage('test-key', 'initial'));

    expect(result.current[0]).toBe('initial');
  });

  it('should update value', () => {
    const { result } = renderHook(() => useLocalStorage('test-key', 'initial'));

    act(() => {
      result.current[1]('updated');
    });

    expect(result.current[0]).toBe('updated');
  });

  it('should read from localStorage if available', () => {
    localStorage.setItem('existing-key', '"stored"');

    const { result } = renderHook(() => useLocalStorage('existing-key', 'default'));

    expect(result.current[0]).toBe('stored');
  });
});
