import { SimulationParams, KeyMetrics, TaxScenario, TaxRegime } from '../types.ts';

// Alíquotas e bases de presunção simplificadas.
// NOTA: Estes são valores de exemplo e não devem ser usados para fins fiscais reais sem validação.
const PRESUNCAO_IRPJ_SERVICO = 0.32;
const PRESUNCAO_CSLL_SERVICO = 0.32;
const PRESUNCAO_IRPJ_COMERCIO = 0.08;
const PRESUNCAO_CSLL_COMERCIO = 0.12;

const ALIQUOTA_IRPJ = 0.15;
const ADICIONAL_IRPJ = 0.10;
const ALIQUOTA_CSLL = 0.09;
const ALIQUOTA_PIS_PRESUMIDO = 0.0065;
const ALIQUOTA_COFINS_PRESUMIDO = 0.03;

const ALIQUOTA_PIS_REAL = 0.0165;
const ALIQUOTA_COFINS_REAL = 0.076;

const getBasePresuncao = (tipoOperacao: string) => {
    return tipoOperacao === 'Prestação de Serviço'
        ? { irpj: PRESUNCAO_IRPJ_SERVICO, csll: PRESUNCAO_CSLL_SERVICO }
        : { irpj: PRESUNCAO_IRPJ_COMERCIO, csll: PRESUNCAO_CSLL_COMERCIO };
};

const calculateLucroPresumido = (params: SimulationParams, metrics: KeyMetrics): TaxScenario => {
    const { valorBase, uf, tipoOperacao } = params;
    const { irpj: baseIRPJ, csll: baseCSLL } = getBasePresuncao(tipoOperacao);

    const baseCalculoIRPJ = valorBase * baseIRPJ;
    const irpj = baseCalculoIRPJ * ALIQUOTA_IRPJ;
    // Adicional de IRPJ (simplificado)
    const adicionalIRPJ = Math.max(0, (baseCalculoIRPJ - 20000 * 12) / 12 * ADICIONAL_IRPJ);

    const baseCalculoCSLL = valorBase * baseCSLL;
    const csll = baseCalculoCSLL * ALIQUOTA_CSLL;

    const pis = valorBase * ALIQUOTA_PIS_PRESUMIDO;
    const cofins = valorBase * ALIQUOTA_COFINS_PRESUMIDO;
    
    // Usando o ICMS do relatório como uma aproximação
    const icms = metrics.valorTotalDeICMS * (valorBase / metrics.valorTotalDasNfes) || valorBase * 0.18;

    const cargaTributariaTotal = irpj + adicionalIRPJ + csll + pis + cofins + icms;
    const aliquotaEfetiva = ((cargaTributariaTotal / valorBase) * 100).toFixed(2) + '%';

    return {
        nome: TaxRegime.LUCRO_PRESUMIDO,
        parametros: { regime: TaxRegime.LUCRO_PRESUMIDO, uf },
        cargaTributariaTotal,
        aliquotaEfetiva,
        impostos: { IRPJ: irpj + adicionalIRPJ, CSLL: csll, PIS: pis, COFINS: cofins, ICMS: icms },
        recomendacoes: [] // Será preenchido pela IA
    };
};

const calculateLucroReal = (params: SimulationParams, metrics: KeyMetrics): TaxScenario => {
    const { valorBase, uf } = params;
    // Estimativa de Lucro (simplificada como 20% do faturamento para simulação)
    const lucroEstimado = valorBase * 0.20;

    const irpj = lucroEstimado * ALIQUOTA_IRPJ;
    const adicionalIRPJ = Math.max(0, (lucroEstimado - 20000 * 12) / 12 * ADICIONAL_IRPJ);
    const csll = lucroEstimado * ALIQUOTA_CSLL;

    const pis = valorBase * ALIQUOTA_PIS_REAL;
    const cofins = valorBase * ALIQUOTA_COFINS_REAL;
    
    const icms = metrics.valorTotalDeICMS * (valorBase / metrics.valorTotalDasNfes) || valorBase * 0.18;

    const cargaTributariaTotal = irpj + adicionalIRPJ + csll + pis + cofins + icms;
    const aliquotaEfetiva = ((cargaTributariaTotal / valorBase) * 100).toFixed(2) + '%';

    return {
        nome: TaxRegime.LUCRO_REAL,
        parametros: { regime: TaxRegime.LUCRO_REAL, uf },
        cargaTributariaTotal,
        aliquotaEfetiva,
        impostos: { IRPJ: irpj + adicionalIRPJ, CSLL: csll, PIS: pis, COFINS: cofins, ICMS: icms },
        recomendacoes: []
    };
};

const calculateSimplesNacional = (params: SimulationParams, metrics: KeyMetrics): TaxScenario => {
    const { valorBase, uf } = params;
    // Alíquota simplificada do Simples Nacional (ex: Anexo I para Comércio)
    let aliquotaSimples = 0.04; // Faixa inicial
    if (valorBase > 180000) aliquotaSimples = 0.073;
    if (valorBase > 360000) aliquotaSimples = 0.095;
    
    const cargaTributariaTotal = valorBase * aliquotaSimples;
    const aliquotaEfetiva = (aliquotaSimples * 100).toFixed(2) + '%';

    // A divisão dos impostos dentro do Simples é complexa, aqui é uma estimativa
    const impostosEstimados = {
        'CPP (INSS)': cargaTributariaTotal * 0.4,
        ICMS: cargaTributariaTotal * 0.3,
        IRPJ: cargaTributariaTotal * 0.05,
        CSLL: cargaTributariaTotal * 0.035,
        COFINS: cargaTributariaTotal * 0.12,
        PIS: cargaTributariaTotal * 0.027,
    };

    return {
        nome: TaxRegime.SIMPLES_NACIONAL,
        parametros: { regime: TaxRegime.SIMPLES_NACIONAL, uf },
        cargaTributariaTotal,
        aliquotaEfetiva,
        impostos: impostosEstimados,
        recomendacoes: []
    };
};

/**
 * Orchestrates the calculation of all tax scenarios based on the provided parameters.
 * @param params The simulation parameters from the UI.
 * @param metrics The key metrics from the executive summary for context.
 * @returns An array of calculated TaxScenario objects.
 */
export const calculateAllScenarios = (params: SimulationParams, metrics: KeyMetrics): TaxScenario[] => {
    const scenarios: TaxScenario[] = [];
    
    scenarios.push(calculateLucroPresumido(params, metrics));
    scenarios.push(calculateLucroReal(params, metrics));
    scenarios.push(calculateSimplesNacional(params, metrics));

    return scenarios;
};
