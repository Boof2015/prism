const packageJson = require('./package.json')

const excludedResources = new Set(['plugins/', 'tui/'])

module.exports = {
  ...packageJson.build,
  extraResources: packageJson.build.extraResources.filter(
    (resource) => !excludedResources.has(resource.to),
  ),
}
