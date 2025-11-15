module.exports = {
    testEnvironment: 'node',
    coverageDirectory: 'coverage',
    collectCoverageFrom: [
        'agents/**/*.js',
        'routes/**/*.js',
        'services/**/*.js',
        'langchain/**/*.js',
        'middleware/**/*.js',
        '!**/node_modules/**',
        '!**/coverage/**',
        '!services/logger.js',
        '!services/metrics.js',
    ],
    coverageThreshold: {
        global: {
            branches: 10,
            functions: 15,
            lines: 20,
            statements: 20,
        },
    },
};
