import { useState, useCallback } from 'react';

export function useLocalStorage<T>(key: string, initialValue: T): [T, (value: T) => void] {
  const [storedValue, setStoredValue] = useState<T>(() => readStoredValue(key, initialValue));
  const setValue = useCallback(
    (value: T) => persistValue(key, value, setStoredValue),
    [key]
  );
  return [storedValue, setValue];
}

function readStoredValue<T>(key: string, initialValue: T): T {
  try {
    const item = window.localStorage.getItem(key);
    return item ? JSON.parse(item) : initialValue;
  } catch {
    return initialValue;
  }
}

function persistValue<T>(key: string, value: T, setValue: (value: T) => void): void {
  try {
    setValue(value);
    window.localStorage.setItem(key, JSON.stringify(value));
  } catch (error) {
    console.error('Failed to save to localStorage:', error);
  }
}
