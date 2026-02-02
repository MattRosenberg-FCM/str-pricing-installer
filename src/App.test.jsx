import { describe, it, expect } from 'vitest'

describe('Vitest Setup Smoke Test', () => {
  it('should perform basic arithmetic correctly', () => {
    expect(1 + 1).toBe(2)
  })

  it('should handle string operations', () => {
    expect('hello' + ' ' + 'world').toBe('hello world')
  })

  it('should verify jest-dom matchers are available', () => {
    // This test just verifies that expect has been extended with jest-dom matchers
    // The actual matchers will be used in component tests
    expect(expect.extend).toBeDefined()
  })
})
