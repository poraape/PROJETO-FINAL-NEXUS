// backend/services/pipelineConfig.js
/**
 * Centraliza o carregamento e o uso da definição de pipeline declarada em YAML.
 * Mantém uma única fonte de verdade para sequenciamento, índices e rótulos exibidos.
 */

const fs = require('fs');
const path = require('path');
const yaml = require('js-yaml');

const PIPELINE_FILE = path.join(__dirname, '..', 'pipeline.yaml');

let cachedDefinition = null;

const TASK_LABELS = {
    extraction: '1. Extração de Dados',
    validation: '2. Validação de Dados',
    audit: '3. Auditoria Inicial',
    classification: '4. Classificação Fiscal',
    analysis: '5. Análise Executiva (IA)',
    indexing: '6. Indexação Cognitiva',
};

function loadPipelineDefinition() {
    if (cachedDefinition) {
        return cachedDefinition;
    }
    try {
        const fileContent = fs.readFileSync(PIPELINE_FILE, 'utf8');
        cachedDefinition = yaml.load(fileContent) || {};
    } catch (error) {
        cachedDefinition = {};
    }
    return cachedDefinition;
}

function getOrderedTasks() {
    const definition = loadPipelineDefinition();
    return Object.keys(definition);
}

function getFirstTask() {
    return getOrderedTasks()[0] || null;
}

function getNextTask(taskName) {
    const definition = loadPipelineDefinition();
    return definition?.[taskName]?.next || null;
}

function getStepIndex(taskName) {
    const definition = loadPipelineDefinition();
    const index = definition?.[taskName]?.stepIndex;
    return typeof index === 'number' ? index : null;
}

function getTaskLabel(taskName) {
    return TASK_LABELS[taskName] || taskName;
}

function buildInitialPipelineState() {
    return getOrderedTasks().map((taskName, index) => ({
        name: getTaskLabel(taskName),
        status: index === 0 ? 'in-progress' : 'pending',
    }));
}

module.exports = {
    getOrderedTasks,
    getFirstTask,
    getNextTask,
    getStepIndex,
    getTaskLabel,
    buildInitialPipelineState,
};
