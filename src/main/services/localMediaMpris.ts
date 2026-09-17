import type { NowPlayingControlCommand } from '../../types/nowPlaying'

const MPRIS_PLAYER_INTERFACE = 'org.mpris.MediaPlayer2.Player'
const MPRIS_PLAYER_OBJECT_PATH = '/org/mpris/MediaPlayer2'
const SESSION_DBUS_INTERFACE = 'org.freedesktop.DBus'
const SESSION_DBUS_OBJECT_PATH = '/org/freedesktop/DBus'

function normalizeString(value: string | undefined): string {
  return (value ?? '').trim()
}

function escapeRegexLiteral(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

// g_variant_print uses either quote style depending on the text being encoded.
const GVARIANT_STRING = String.raw`(?:'((?:\\.|[^'\\])*)'|"((?:\\.|[^"\\])*)")`
function decodeGVariantString(value: string): string {
  return value.replace(/\\([\\'"nrtbf])/g, (_match, escaped: string) => ({
    n: '\n', r: '\r', t: '\t', b: '\b', f: '\f',
  }[escaped] ?? escaped))
}
function decodedMatch(match: RegExpMatchArray | null): string {
  return normalizeString(decodeGVariantString(match?.[1] ?? match?.[2] ?? ''))
}
export function extractGdbusStringVariant(output: string, key: string): string {
  return decodedMatch(output.match(new RegExp(`'${escapeRegexLiteral(key)}': <(?:@s )?${GVARIANT_STRING}>`)))
}
export function extractGdbusObjectPathVariant(output: string, key: string): string {
  return decodedMatch(output.match(new RegExp(`'${escapeRegexLiteral(key)}': <(?:objectpath |@o )${GVARIANT_STRING}>`)))
}

export function extractGdbusInt64Variant(output: string, key: string): number {
  const match = output.match(new RegExp(`'${escapeRegexLiteral(key)}': <(?:@x |@t |int64 |uint64 )?(-?\\d+)>`))
  if (!match) {
    return 0
  }

  const numeric = Number.parseInt(match[1], 10)
  if (!Number.isFinite(numeric)) {
    return 0
  }

  return Math.max(0, numeric)
}

export function extractGdbusStringArrayVariant(output: string, key: string): string[] {
  const match = output.match(new RegExp(`'${escapeRegexLiteral(key)}': <(?:@as )?\\[([\\s\\S]*?)\\]>`))
  if (!match?.[1]) {
    return []
  }

  return parseLinuxBusNames(match[1])
}

export function parseLinuxBusNames(output: string): string[] {
  return Array.from(output.matchAll(new RegExp(GVARIANT_STRING, 'g')), decodedMatch).filter(Boolean)
}

export function buildLinuxListNamesArgs(): string[] {
  return [
    'call',
    '--session',
    '--dest',
    SESSION_DBUS_INTERFACE,
    '--object-path',
    SESSION_DBUS_OBJECT_PATH,
    '--method',
    `${SESSION_DBUS_INTERFACE}.ListNames`,
  ]
}

export function buildLinuxPropertiesArgs(busName: string, interfaceName = MPRIS_PLAYER_INTERFACE): string[] {
  return [
    'call',
    '--session',
    '--dest',
    busName,
    '--object-path',
    MPRIS_PLAYER_OBJECT_PATH,
    '--method',
    'org.freedesktop.DBus.Properties.GetAll',
    interfaceName,
  ]
}

export function buildLinuxCommandArgs(busName: string, command: NowPlayingControlCommand): string[] {
  const methodName = (() => {
    switch (command) {
      case 'play':
        return 'Play'
      case 'pause':
        return 'Pause'
      case 'next':
        return 'Next'
      case 'previous':
        return 'Previous'
    }
  })()

  return [
    'call',
    '--session',
    '--dest',
    busName,
    '--object-path',
    MPRIS_PLAYER_OBJECT_PATH,
    '--method',
    `${MPRIS_PLAYER_INTERFACE}.${methodName}`,
  ]
}

