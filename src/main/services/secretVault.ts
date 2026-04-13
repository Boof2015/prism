import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { dirname } from 'node:path'

interface SafeStorageLike {
  decryptString(encrypted: Buffer): string
  encryptString(plainText: string): Buffer
  getSelectedStorageBackend?: () => string
  isEncryptionAvailable(): boolean
}

interface SecretVaultOptions {
  path: string
  platform: NodeJS.Platform
  safeStorage: SafeStorageLike
}

interface SecretVaultFile {
  version: 1
  secrets: Record<string, string>
}

const EMPTY_VAULT: SecretVaultFile = {
  version: 1,
  secrets: {},
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null
}

function normalizeVaultFile(raw: unknown): SecretVaultFile {
  if (!isRecord(raw)) {
    return { ...EMPTY_VAULT, secrets: {} }
  }

  const rawSecrets = isRecord(raw.secrets) ? raw.secrets : {}
  const secrets = Object.entries(rawSecrets).reduce((acc, [key, value]) => {
    if (typeof value === 'string' && value.trim()) {
      acc[key] = value.trim()
    }
    return acc
  }, {} as Record<string, string>)

  return {
    version: 1,
    secrets,
  }
}

function getVaultUnavailableMessage(platform: NodeJS.Platform): string {
  if (platform === 'linux') {
    return 'Secure secret storage is unavailable because Prism could not access a supported Linux keyring.'
  }

  return 'Secure secret storage is unavailable on this device.'
}

export class SecretVault {
  private readonly path: string
  private readonly platform: NodeJS.Platform
  private readonly safeStorage: SafeStorageLike

  constructor(options: SecretVaultOptions) {
    this.path = options.path
    this.platform = options.platform
    this.safeStorage = options.safeStorage
  }

  async getSecret(key: string): Promise<string | null> {
    const vault = await this.readVaultFile()
    const encoded = vault.secrets[key]
    if (!encoded) {
      return null
    }

    this.assertEncryptionAvailable()
    return this.safeStorage.decryptString(Buffer.from(encoded, 'base64'))
  }

  async setSecret(key: string, value: string): Promise<void> {
    this.assertEncryptionAvailable()

    const normalized = value.trim()
    if (!normalized) {
      await this.deleteSecret(key)
      return
    }

    const vault = await this.readVaultFile()
    vault.secrets[key] = this.safeStorage.encryptString(normalized).toString('base64')
    await this.writeVaultFile(vault)
  }

  async deleteSecret(key: string): Promise<void> {
    const vault = await this.readVaultFile()
    if (!vault.secrets[key]) {
      return
    }

    delete vault.secrets[key]
    await this.writeVaultFile(vault)
  }

  private assertEncryptionAvailable(): void {
    if (!this.safeStorage.isEncryptionAvailable()) {
      throw new Error(getVaultUnavailableMessage(this.platform))
    }

    if (this.platform === 'linux' && typeof this.safeStorage.getSelectedStorageBackend === 'function') {
      const backend = this.safeStorage.getSelectedStorageBackend()
      if (backend === 'basic_text' || backend === 'unknown') {
        throw new Error(getVaultUnavailableMessage(this.platform))
      }
    }
  }

  private async readVaultFile(): Promise<SecretVaultFile> {
    try {
      const raw = await readFile(this.path, 'utf8')
      return normalizeVaultFile(JSON.parse(raw) as unknown)
    } catch {
      return { ...EMPTY_VAULT, secrets: {} }
    }
  }

  private async writeVaultFile(vault: SecretVaultFile): Promise<void> {
    await mkdir(dirname(this.path), { recursive: true })
    await writeFile(this.path, `${JSON.stringify(vault, null, 2)}\n`, 'utf8')
  }
}
