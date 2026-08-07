import { beforeEach, describe, expect, it } from 'vitest'
import {
  create,
  createSearchProvider,
  has,
  providers,
  register,
} from '../../src/core/registry.ts'
import {
  InvalidProviderUrlError,
  SearchNotSupportedError,
  UnknownProviderError,
} from '../../src/core/errors.ts'
import { Provider } from '../../src/core/provider.ts'
import type { ProviderConfig, SearchResult } from '../../src/core/types.ts'

describe('registry', () => {
  // Use unique names per test suite to avoid collisions with module-level Maps.
  const testProviderName = `testprovider${Math.random().toString(36).slice(2)}`
  const testProviderName2 = `testprovider${Math.random().toString(36).slice(2)}`
  const envVarName = `${testProviderName.toUpperCase()}_API_KEY`

  class MockProvider extends Provider {
    static readonly providerName = testProviderName
    static readonly defaultBaseURL = 'https://api.example.com'
    static readonly capturedConfigs: ProviderConfig[] = []

    constructor(config: ProviderConfig) {
      super(config, MockProvider)
      MockProvider.capturedConfigs.push(config)
    }

    async search(): Promise<SearchResult[]> {
      return []
    }
  }

  class SecondMockProvider extends Provider {
    static readonly providerName = testProviderName2
    static readonly defaultBaseURL = 'https://api2.example.com'

    constructor(config: ProviderConfig) {
      super(config, SecondMockProvider)
    }
  }

  class ReadOnlyProvider extends Provider {
    static readonly providerName = testProviderName2
    static readonly defaultBaseURL = 'https://reader.example.com'

    constructor(config: ProviderConfig) {
      super(config, ReadOnlyProvider)
    }

    async read(): Promise<{ url: string; content: string }> {
      return { url: 'https://example.com', content: 'ok' }
    }
  }

  beforeEach(() => {
    delete process.env[envVarName]
    MockProvider.capturedConfigs.length = 0
  })

  describe('register() + has()', () => {
    it('registers a provider class', () => {
      register(MockProvider)
      expect(has(testProviderName)).toBe(true)
    })

    it('returns false for unregistered providers', () => {
      const unregisteredName = `nonexistent-${Math.random().toString(36).slice(2)}`
      expect(has(unregisteredName)).toBe(false)
    })
  })

  describe('providers()', () => {
    it('includes registered provider class names', () => {
      register(MockProvider)
      expect(providers()).toContain(testProviderName)
    })

    it('returns every registered provider class name', () => {
      register(MockProvider)
      register(SecondMockProvider)

      const registeredProviders = providers()
      expect(registeredProviders).toContain(testProviderName)
      expect(registeredProviders).toContain(testProviderName2)
      expect(Array.isArray(registeredProviders)).toBe(true)
    })
  })

  describe('create()', () => {
    it('creates an instance of the abstract provider base', () => {
      register(MockProvider)

      const provider = create(testProviderName)

      expect(provider).toBeInstanceOf(Provider)
      expect(provider.name).toBe(testProviderName)
    })

    it('keeps provider identity immutable at runtime', () => {
      register(MockProvider)
      const provider = create(testProviderName)

      expect(() => Object.assign(provider, { name: 'changed' })).toThrow(TypeError)
      expect(provider.name).toBe(testProviderName)
    })

    it('passes config.apiKey to the provider constructor', () => {
      register(MockProvider)
      const apiKey = 'test-api-key-12345'

      create(testProviderName, { apiKey })

      expect(MockProvider.capturedConfigs).toHaveLength(1)
      expect(MockProvider.capturedConfigs[0]?.apiKey).toBe(apiKey)
    })

    it('reads the API key from the environment', () => {
      register(MockProvider)
      const apiKey = 'env-api-key-67890'
      process.env[envVarName] = apiKey

      create(testProviderName)

      expect(MockProvider.capturedConfigs[0]?.apiKey).toBe(apiKey)
    })

    it('prefers config.apiKey over the environment', () => {
      register(MockProvider)
      process.env[envVarName] = 'env-api-key'

      create(testProviderName, { apiKey: 'config-api-key' })

      expect(MockProvider.capturedConfigs[0]?.apiKey).toBe('config-api-key')
    })

    it('throws for an unregistered provider name', () => {
      const unregisteredName = `unknown-${Math.random().toString(36).slice(2)}`
      expect(() => create(unregisteredName)).toThrow(UnknownProviderError)
      expect(() => create(unregisteredName)).toThrow(`Unknown provider: ${unregisteredName}`)
    })

    it('passes a custom baseURL to the provider constructor', () => {
      register(MockProvider)

      create(testProviderName, { baseURL: 'https://custom.example.com' })

      expect(MockProvider.capturedConfigs[0]?.baseURL).toBe('https://custom.example.com')
    })

    it('rejects provider base URLs that are not absolute HTTP(S) URLs', () => {
      register(MockProvider)

      for (const baseURL of ['ftp://example.com', '/relative']) {
        expect(() => create(testProviderName, { baseURL })).toThrow(InvalidProviderUrlError)
      }

      expect(() => create(testProviderName, { baseURL: 'ftp://example.com' }))
        .toThrow(`Invalid base URL for provider "${testProviderName}": expected an absolute http or https URL`)
    })

    it('uses class metadata as the default baseURL', () => {
      register(MockProvider)

      create(testProviderName)

      expect(MockProvider.capturedConfigs[0]?.baseURL).toBe(MockProvider.defaultBaseURL)
    })
  })

  describe('capabilities', () => {
    it('returns a search-capable provider when required', async () => {
      register(MockProvider)

      const provider = createSearchProvider(testProviderName)

      await expect(provider.search('query')).resolves.toEqual([])
    })

    it('rejects a read-only provider when search is required', () => {
      register(ReadOnlyProvider)

      expect(() => createSearchProvider(testProviderName2)).toThrow(SearchNotSupportedError)
    })
  })
})
