#!/usr/bin/env node
import { execSync } from 'node:child_process';
import { mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import process from 'node:process';

const repoRoot = process.cwd();
const workspaces = [
  { name: 'frontend', cwd: repoRoot },
  { name: 'backend', cwd: path.join(repoRoot, 'backend') },
];

function runJson(command, cwd) {
  try {
    const output = execSync(command, { cwd, stdio: ['ignore', 'pipe', 'pipe'] }).toString();
    return output.trim() ? JSON.parse(output) : {};
  } catch (error) {
    const text = error.stdout?.toString();
    if (text && text.trim()) {
      try {
        return JSON.parse(text);
      } catch (parseErr) {
        console.error(`[deps:audit] Falha ao interpretar JSON (${command}).`, parseErr);
      }
    }
    throw error;
  }
}

function summarizeAudit(metadata = {}) {
  const { vulnerabilities = {} } = metadata;
  return {
    critical: vulnerabilities.critical || 0,
    high: vulnerabilities.high || 0,
    moderate: vulnerabilities.moderate || vulnerabilities.medium || 0,
    low: vulnerabilities.low || 0,
    info: vulnerabilities.info || 0,
  };
}

const report = {
  generatedAt: new Date().toISOString(),
  workspaces: [],
};

for (const workspace of workspaces) {
  console.log(`\n[deps:audit] Analisando ${workspace.name} (${workspace.cwd})`);
  const outdated = runJson('npm outdated --json || true', workspace.cwd);
  const audit = runJson('npm audit --omit=dev --json || true', workspace.cwd);

  const auditSummary = summarizeAudit(audit.metadata || audit);
  const outdatedCount = Object.keys(outdated || {}).length;
  console.log(
    `[deps:audit] ${workspace.name}: ${outdatedCount} dependência(s) desatualizada(s); ` +
      `Vulnerabilidades (crit/high/mod/low): ${auditSummary.critical}/${auditSummary.high}/` +
      `${auditSummary.moderate}/${auditSummary.low}`
  );

  report.workspaces.push({
    name: workspace.name,
    path: workspace.cwd,
    outdated,
    audit: auditSummary,
  });

  if (auditSummary.critical > 0) {
    console.warn(
      `[deps:audit] ${workspace.name} possui vulnerabilidades críticas. Revise o relatório JSON para detalhes.`
    );
  }
}

const reportDir = path.join(repoRoot, 'reports');
mkdirSync(reportDir, { recursive: true });
const outputPath = path.join(reportDir, 'dependency-audit-report.json');
writeFileSync(outputPath, JSON.stringify(report, null, 2));
console.log(`\n[deps:audit] Relatório consolidado em ${outputPath}`);
