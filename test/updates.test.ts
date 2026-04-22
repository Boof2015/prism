import assert from 'node:assert/strict'
import test from 'node:test'
import {
  RELEASES_PAGE_URL,
  checkForUpdates,
  resolveSafeReleaseUrl,
  type GitHubReleaseResponse,
} from '../src/main/services/updates'

function release(overrides: Partial<GitHubReleaseResponse>): GitHubReleaseResponse {
  return {
    tag_name: 'v0.1.0',
    name: 'Prism 0.1.0',
    html_url: 'https://github.com/Boof2015/prism/releases/tag/v0.1.0',
    draft: false,
    published_at: '2026-01-01T00:00:00.000Z',
    ...overrides,
  }
}

test('newer semver release reports an update', async () => {
  const result = await checkForUpdates('0.1.0', {
    fetchReleases: async () => [
      release({
        tag_name: 'v0.2.0',
        name: 'Prism 0.2.0',
        html_url: 'https://github.com/Boof2015/prism/releases/tag/v0.2.0',
      }),
    ],
  })

  assert.equal(result.status, 'update-available')
  assert.equal(result.updateAvailable, true)
  assert.equal(result.latestVersion, '0.2.0')
})

test('leading v tags normalize to the current manual app version', async () => {
  const result = await checkForUpdates('0.1.0', {
    fetchReleases: async () => [release({ tag_name: 'v0.1.0' })],
  })

  assert.equal(result.status, 'up-to-date')
  assert.equal(result.updateAvailable, false)
})

test('prerelease tags are eligible as the latest release', async () => {
  const result = await checkForUpdates('0.5.1', {
    fetchReleases: async () => [
      release({
        tag_name: 'v0.5.2-beta',
        name: 'Prism 0.5.2 Beta',
        published_at: '2026-03-01T00:00:00.000Z',
      }),
    ],
  })

  assert.equal(result.status, 'update-available')
  assert.equal(result.latestVersion, '0.5.2-beta')
})

test('draft releases are ignored', async () => {
  const result = await checkForUpdates('0.1.0', {
    fetchReleases: async () => [
      release({
        tag_name: 'v9.0.0',
        draft: true,
        published_at: '2026-04-01T00:00:00.000Z',
      }),
      release({
        tag_name: 'v0.1.0',
        published_at: '2026-03-01T00:00:00.000Z',
      }),
    ],
  })

  assert.equal(result.status, 'up-to-date')
  assert.equal(result.latestTag, 'v0.1.0')
})

test('safe release URL handling is limited to Prism GitHub releases', () => {
  assert.equal(
    resolveSafeReleaseUrl('https://github.com/Boof2015/prism/releases/tag/v0.2.0'),
    'https://github.com/Boof2015/prism/releases/tag/v0.2.0',
  )
  assert.equal(resolveSafeReleaseUrl('https://github.com/Boof2015/prism/issues'), RELEASES_PAGE_URL)
  assert.equal(resolveSafeReleaseUrl('https://example.com/Boof2015/prism/releases'), RELEASES_PAGE_URL)
  assert.equal(resolveSafeReleaseUrl('http://github.com/Boof2015/prism/releases'), RELEASES_PAGE_URL)
})
