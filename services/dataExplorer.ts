import { JobAnalytics } from '../types.ts';

interface StructuredAnswer {
  answer: string;
  sources: string[];
}

const currency = new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' });

function formatValue(value: number) {
  return currency.format(value || 0);
}

export function buildStructuredAnalyticsAnswer(question: string, analytics?: JobAnalytics | null): StructuredAnswer | null {
  if (!analytics || !analytics.ready) {
    return null;
  }

  const normalized = question.toLowerCase();
  if (/total(\s+geral)?\s+de\s+nf|quantidade\s+de\s+notas/.test(normalized)) {
    return {
      answer: `Foram processadas ${analytics.totals.documents} NF-e com valor agregado de ${formatValue(analytics.totals.nfeValue)}.`,
      sources: analytics.sourceMap.timeSeries.flatMap(point => point.files).slice(0, 5),
    };
  }

  if (/imposto|icms|pis|cofins|iss/.test(normalized)) {
    const taxes = analytics.totals.taxes;
    const parts = [
      `ICMS: ${formatValue(taxes.icms)}`,
      `PIS: ${formatValue(taxes.pis)}`,
      `COFINS: ${formatValue(taxes.cofins)}`,
      `ISS: ${formatValue(taxes.iss)}`,
    ];
    return {
      answer: `Com base na análise determinística, o lote possui ${parts.join(' · ')}.`,
      sources: analytics.sourceMap.cfops.flatMap(entry => entry.files).slice(0, 5),
    };
  }

  const cfopMatch = question.match(/cfop\s*(\d{4})/i);
  if (cfopMatch) {
    const cfop = cfopMatch[1];
    const entry = analytics.cfopBreakdown.find(item => item.label === cfop);
    if (entry) {
      return {
        answer: `O CFOP ${cfop} aparece em ${entry.documents} documento(s) totalizando ${formatValue(entry.value)}.`,
        sources: entry.sources?.slice(0, 5) || [],
      };
    }
  }

  const cnpjMatch = question.match(/\b\d{2}\.?\d{3}\.?\d{3}\/\d{4}-?\d{2}\b/);
  if (cnpjMatch) {
    const entry = analytics.customerBreakdown.find(item => item.label.includes(cnpjMatch[0]));
    if (entry) {
      return {
        answer: `O CNPJ ${entry.label} possui ${entry.documents} documento(s) com valor consolidado de ${formatValue(entry.value)}.`,
        sources: entry.sources?.slice(0, 5) || [],
      };
    }
  }

  const periodMatch = question.match(/\b\d{4}-\d{2}-\d{2}\b/);
  if (periodMatch) {
    const entry = analytics.timeSeries.find(item => item.period === periodMatch[0]);
    if (entry) {
      return {
        answer: `No dia ${entry.period} foram registrados ${entry.documents} documento(s) somando ${formatValue(entry.totalValue)}.`,
        sources: entry.fileNames?.slice(0, 5) || [],
      };
    }
  }

  if (/qualidade\s+dos\s+dados|arquivos\s+inconsistentes|encoding/.test(normalized) && analytics.dataQuality) {
    const dq = analytics.dataQuality;
    return {
      answer: `Validação pré-LLM concluiu ${dq.totals.files} arquivo(s), ${dq.totals.structured} estruturado(s), ${dq.totals.warnings} alerta(s) e ${dq.totals.errors} erro(s).`,
      sources: dq.files.slice(0, 3).map(file => file.name),
    };
  }

  return null;
}
