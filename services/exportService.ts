// services/exportService.ts
import jsPDF from 'jspdf';
import html2canvas from 'html2canvas';
import { Document, Packer, Paragraph, TextRun, HeadingLevel, ImageRun } from 'docx';

/**
 * Função utilitária para salvar um blob de arquivo.
 * @param blob O conteúdo do arquivo.
 * @param nome O nome do arquivo a ser salvo.
 */
function salvarArquivo(blob: Blob, nome: string) {
  const link = document.createElement("a");
  link.href = URL.createObjectURL(blob);
  link.download = nome;
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  URL.revokeObjectURL(link.href);
}

/**
 * Captura o elemento HTML do painel de controle ativo.
 * @returns Um elemento HTML ou nulo se não for encontrado.
 */
function capturarElementoDashboard(): HTMLElement | null {
  const dashboardContent = document.querySelector('#dashboard-view-content > div');
  return dashboardContent as HTMLElement | null;
}

/**
 * Extrai as mensagens do chat interativo a partir do DOM.
 * @returns Um array de objetos representando as mensagens do chat.
 */
function capturarMensagensChat(): { sender: string; content: string }[] {
  const messages: { sender: string; content: string }[] = [];
  const messageNodes = document.querySelectorAll('#chat-messages-container > div.flex.items-start');
  
  messageNodes.forEach(node => {
      const isUser = (node as HTMLElement).classList.contains('justify-end');
      const sender = isUser ? 'Usuário' : 'Nexus AI';
      const contentEl = node.querySelector('p');
      if (contentEl) {
          messages.push({ sender, content: contentEl.innerText });
      }
  });

  return messages;
}

/**
 * Gera um cabeçalho HTML padronizado para os relatórios.
 * @returns Uma string HTML contendo o cabeçalho.
 */
function gerarCabecalhoPadraoHTML(): string {
  const data = new Date().toLocaleString('pt-BR');
  return `
  <header style="text-align:center; margin-bottom: 2rem; border-bottom: 1px solid #eee; padding-bottom: 1rem;">
    <h1 style="font-size: 24px; font-weight: bold; margin: 0; color: #1a1a1a;">Nexus QuantumI2A2 — Relatório Analítico</h1>
    <p style="font-size: 12px; color: #555; margin: 5px 0 0 0;">
      <strong>Exportado em:</strong> ${data}
    </p>
  </header>
  `;
}

/**
 * Monta o documento HTML completo a ser exportado.
 * @returns Uma string contendo o HTML completo do documento.
 */
function montarDocumentoCompletoHTML(): string {
  const dashboardEl = capturarElementoDashboard();
  const chatMessages = capturarMensagensChat();
  
  const dashboardHtml = dashboardEl ? dashboardEl.outerHTML : '<h2>Painel Analítico</h2><p>Conteúdo não encontrado.</p>';
  
  const chatHtml = chatMessages.map(m => 
    `<div style="margin-bottom: 10px; padding: 8px; border-radius: 5px; background-color: ${m.sender === 'Usuário' ? '#e9eaf6' : '#f4f4f5'};">
        <strong style="color: #333;">${m.sender}:</strong>
        <p style="margin: 5px 0 0 0; white-space: pre-wrap; word-wrap: break-word;">${m.content}</p>
     </div>`
  ).join("\n");

  return `
    ${gerarCabecalhoPadraoHTML()}
    <section id="dashboard-export">${dashboardHtml}</section>
    <div style="page-break-before: always;"></div>
    <section id="chat-export">
      <h2 style="font-size: 20px; font-weight: bold; border-bottom: 1px solid #eee; padding-bottom: 5px;">💬 Conversa com IA</h2>
      ${chatHtml}
    </section>
  `;
}

/**
 * Gera e baixa um arquivo PDF com o conteúdo.
 */
async function gerarPDF() {
  const tempContainer = document.createElement('div');
  // Estilos para renderização fora da tela
  tempContainer.style.position = 'absolute';
  tempContainer.style.left = '-9999px';
  tempContainer.style.width = '700px'; // Largura similar a A4
  tempContainer.style.backgroundColor = 'white'; // Garante fundo não transparente
  tempContainer.innerHTML = montarDocumentoCompletoHTML();
  document.body.appendChild(tempContainer);
  
  const pdf = new jsPDF({
    orientation: 'p',
    unit: 'pt',
    format: 'a4',
  });
  
  await pdf.html(tempContainer, {
    callback: (doc) => {
      doc.save(`Relatorio_Nexus_QuantumI2A2_${Date.now()}.pdf`);
      document.body.removeChild(tempContainer);
    },
    margin: [40, 40, 40, 40],
    autoPaging: 'slice',
    html2canvas: {
      scale: 0.7,
      useCORS: true,
      logging: false,
      backgroundColor: '#ffffff', // Importante para a renderização do canvas
    }
  });
}

/**
 * Gera e baixa um arquivo DOCX com o conteúdo.
 */
async function gerarDOCX() {
    const dashboardEl = capturarElementoDashboard();
    const chatMessages = capturarMensagensChat();
    const children: (Paragraph | ImageRun)[] = [];

    children.push(new Paragraph({ text: "Nexus QuantumI2A2 — Relatório Analítico", heading: HeadingLevel.TITLE }));
    children.push(new Paragraph({ text: `Exportado em: ${new Date().toLocaleString('pt-BR')}`, style: "IntenseQuote" }));

    if (dashboardEl) {
        const dashboardTitle = dashboardEl.querySelector('h2');
        children.push(new Paragraph({ text: dashboardTitle ? dashboardTitle.innerText : "Painel Analítico", heading: HeadingLevel.HEADING_1, spacing: { before: 400 } }));

        const canvas = await html2canvas(dashboardEl, {
            useCORS: true,
            backgroundColor: document.body.classList.contains('light-theme') ? '#F9FAFB' : '#0D1117'
        });
        const dataUrl = canvas.toDataURL();
        
        children.push(new Paragraph({
            children: [
                new ImageRun({
                    data: dataUrl,
                    transformation: {
                        width: 600,
                        height: (canvas.height * 600) / canvas.width,
                    },
                }),
            ]
        }));
    }

    if (chatMessages.length > 0) {
        children.push(new Paragraph({ text: "Conversa com IA", heading: HeadingLevel.HEADING_1, pageBreakBefore: true, spacing: { before: 400 } }));
        chatMessages.forEach(msg => {
            children.push(new Paragraph({
                children: [
                    new TextRun({ text: `${msg.sender}: `, bold: true }),
                    new TextRun(msg.content),
                ],
                spacing: { after: 200 }
            }));
        });
    }

    const doc = new Document({
        sections: [{
            children,
        }],
    });
  
    const blob = await Packer.toBlob(doc);
    salvarArquivo(blob, `Relatorio_Nexus_QuantumI2A2_${Date.now()}.docx`);
}

/**
 * Gera e baixa um arquivo HTML com o conteúdo.
 */
async function gerarHTML() {
  const theme = document.body.classList.contains('light-theme') ? 'light' : 'dark';
  const colors = theme === 'dark' ? 
    { bg: '#0D1117', text: '#D1D5DB', heading: '#F9FAFB', border: '#333' } : 
    { bg: '#F9FAFB', text: '#374151', heading: '#111827', border: '#ddd' };

  const htmlContent = `
  <!DOCTYPE html>
  <html lang="pt-BR">
  <head>
    <meta charset="utf-8">
    <title>Relatório NexusQuantumI2A2</title>
    <style>
      body { font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif; margin: 40px; background-color: ${colors.bg}; color: ${colors.text}; }
      h1, h2, h3 { color: ${colors.heading}; border-bottom: 1px solid ${colors.border}; padding-bottom: 5px; }
      header, section { margin-bottom: 30px; }
      p { line-height: 1.6; }
      strong { color: ${colors.heading}; }
      /* Estilos básicos para simular componentes Tremor */
      .tremor-Card-root { border: 1px solid ${colors.border}; border-radius: 0.5rem; padding: 1rem; margin-bottom: 1rem; background-color: ${theme === 'dark' ? '#1F2937' : '#FFFFFF'}; }
      .tremor-Title-root { font-size: 1.25rem; font-weight: 600; }
    </style>
  </head>
  <body>
    ${montarDocumentoCompletoHTML().replace('style="text-align:center;', 'style="text-align:left;')}
  </body>
  </html>
  `;
  salvarArquivo(new Blob([htmlContent], { type: "text/html;charset=utf-8" }), `Relatorio_Nexus_QuantumI2A2_${Date.now()}.html`);
}


/**
 * Função principal que orquestra a exportação completa.
 * @param formato O formato de arquivo desejado.
 */
export async function exportarConteudoCompleto(formato: "pdf" | "docx" | "html") {
  console.log(`[ExportService] Iniciando exportação para ${formato.toUpperCase()}`);
  
  try {
    switch (formato) {
      case "pdf":
        await gerarPDF();
        break;
      case "docx":
        await gerarDOCX();
        break;
      case "html":
        await gerarHTML();
        break;
      default:
        throw new Error("Formato de exportação não suportado.");
    }
    console.log(`[ExportService] Exportação para ${formato.toUpperCase()} concluída.`);
  } catch(e) {
      console.error(`[ExportService] Falha ao exportar para ${formato.toUpperCase()}:`, e);
      // Relança o erro para ser capturado pela UI no Header.tsx
      throw e;
  }
}
