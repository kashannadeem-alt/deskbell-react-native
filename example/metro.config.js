// Resolves @deskbell/react-native to the SDK source next door, so edits show up live.
const path = require("path");
const { getDefaultConfig } = require("expo/metro-config");

const config = getDefaultConfig(__dirname);
const sdk = path.resolve(__dirname, "..");
// Escape regex characters first, then let either path separator match.
const escape = (p) => p.replace(/[.*+?^${}()|[\]\\]/g, "\\$&").replace(/\//g, "[/\\\\]");

config.watchFolders = [sdk];
config.resolver.extraNodeModules = { "@deskbell/react-native": sdk };
config.resolver.nodeModulesPaths = [path.resolve(__dirname, "node_modules")];
// The SDK keeps its own dev copies of react / react-native for type-checking; never bundle those.
config.resolver.blockList = [
  ...[].concat(config.resolver.blockList ?? []),
  new RegExp(`^${escape(path.join(sdk, "node_modules"))}[/\\\\].*`),
];

module.exports = config;
