import assert from 'node:assert/strict'
import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test from 'node:test'
import { SecretVault } from '../src/main/services/secretVault'

function createSafeStorageMock(options?: {
  available?: boolean
  backend?: string
}) {
  return {
    decryptString(encrypted: Buffer): string {
      return encrypted.toString('utf8').replace(/^encrypted:/, '')
    },
    encryptString(plainText: string): Buffer {
      return Buffer.from(`encrypted:${plainText}`, 'utf8')
    },
    getSelectedStorageBackend(): string {
      return options?.backend ?? 'gnome_libsecret'
    },
    isEncryptionAvailable(): boolean {
      return options?.available ?? true
    },
  }
}

async function createVault(options?: {
  available?: boolean
  backend?: string
  platform?: NodeJS.Platform
}): Promise<{
  cleanup: () => Promise<void>
  path: string
  vault: SecretVault
}> {
  const rootDir = await mkdtemp(join(tmpdir(), 'prism-secret-vault-tests-'))
  const path = join(rootDir, 'secret-vault.json')
  return {
    cleanup: () => rm(rootDir, { recursive: true, force: true }),
    path,
    vault: new SecretVault({
      path,
      platform: options?.platform ?? 'darwin',
      safeStorage: createSafeStorageMock(options),
    }),
  }
}

test('SecretVault encrypts persisted secrets and can read them back', async () => {
  const harness = await createVault()

  try {
    await harness.vault.setSecret('astra', 'secret-token')
    const rawFile = await readFile(harness.path, 'utf8')
    assert.equal(rawFile.includes('secret-token'), false)
    assert.equal(await harness.vault.getSecret('astra'), 'secret-token')

    await harness.vault.deleteSecret('astra')
    assert.equal(await harness.vault.getSecret('astra'), null)
  } finally {
    await harness.cleanup()
  }
})

test('SecretVault fails closed on Linux basic_text storage backends', async () => {
  const harness = await createVault({
    backend: 'basic_text',
    platform: 'linux',
  })

  try {
    await assert.rejects(
      () => harness.vault.setSecret('astra', 'secret-token'),
      /supported Linux keyring/,
    )
  } finally {
    await harness.cleanup()
  }
})
