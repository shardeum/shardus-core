export class FIFOCache<K, V> {
  private map: Map<K, V>
  private capacity: number

  constructor(capacity: number) {
    this.map = new Map<K, V>()
    this.capacity = capacity
  }

  set(key: K, value: V): void {
    if (this.map.size >= this.capacity) {
      // Remove the oldest entry
      const oldestKey = this.map.keys().next().value
      this.map.delete(oldestKey)
    }
    this.map.set(key, value)
  }

  get(key: K): V | undefined {
    return this.map.get(key)
  }

  delete(key: K): boolean {
    return this.map.delete(key)
  }

  clear(): void {
    this.map.clear()
  }

  size(): number {
    return this.map.size
  }

  entries(): IterableIterator<[K, V]> {
    return this.map.entries()
  }
}
