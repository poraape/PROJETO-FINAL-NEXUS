const isTestEnv = process.env.NODE_ENV === 'test' || process.env.SKIP_HEAVY_EXTRACTOR === 'true';

if (isTestEnv) {
  module.exports = require('./extractor.mock');
} else {
  module.exports = require('./extractor.impl');
}
