import { useCallback, useEffect, useState } from 'react'

/**
 * A view preference that survives a reload.
 *
 * For choices about how a screen is arranged — list or cards, archive shown or
 * hidden — not for data. Someone who works through the roster branch by branch
 * should not have to re-pick the card view every morning, and someone who never
 * wants to see separated staff should not have to hide them again after every
 * navigation.
 *
 * Reads and writes are guarded: a private window, cleared site data or a
 * browser set to block storage all throw on access rather than returning null,
 * and a preference is never worth breaking a page over. The fallback is simply
 * the default value, so the screen still renders correctly with nothing stored.
 */
export function useStoredPreference<T extends string>(
  key: string,
  fallback: T,
  allowed: readonly T[]
): [T, (value: T) => void] {
  const [value, setValue] = useState<T>(() => {
    try {
      const stored = window.localStorage.getItem(key)
      return allowed.includes(stored as T) ? (stored as T) : fallback
    } catch {
      return fallback
    }
  })

  useEffect(() => {
    try {
      window.localStorage.setItem(key, value)
    } catch {
      // Not worth a broken screen. The choice just does not persist.
    }
  }, [key, value])

  const set = useCallback((next: T) => setValue(next), [])
  return [value, set]
}
