#!/bin/bash

# Script para iniciar o ambiente de desenvolvimento completo do Nexus QuantumI2A2.

# Define cores para uma saída mais legível
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
RED='\033[0;31m'
NC='\033[0m' # No Color

ROOT_DIR="$(pwd)"
COMPOSE_FILE="${ROOT_DIR}/docker-compose.yml"

if docker compose version >/dev/null 2>&1; then
    COMPOSE_CMD=(docker compose)
elif command -v docker-compose >/dev/null 2>&1; then
    COMPOSE_CMD=(docker-compose)
else
    echo -e "${RED}Erro: Docker Compose não está instalado. Instale o Docker Compose v2 ou v1 para continuar.${NC}"
    exit 1
fi

echo -e "${GREEN}🚀 Iniciando ambiente de desenvolvimento do Nexus QuantumI2A2...${NC}"

# --- ESTRATÉGIA ROBUSTA: Limpa o ambiente Docker antes de começar ---
echo -e "\n${YELLOW}🧹 Limpando ambiente Docker anterior (se existir)...${NC}"
"${COMPOSE_CMD[@]}" -f "${COMPOSE_FILE}" down --remove-orphans >/dev/null 2>&1 || true

# Detecta se estamos em WSL1, que não é suportado pelo Node.js 20+.
is_wsl() {
    [ -f /proc/version ] && grep -qi microsoft /proc/version
}

is_wsl2() {
    [ -f /proc/sys/kernel/osrelease ] && grep -qi "microsoft-standard" /proc/sys/kernel/osrelease
}

if is_wsl && ! is_wsl2; then
    echo -e "${RED}Erro: WSL 1 não é suportado por este ambiente.${NC}"
    echo -e "${RED}Por favor, rode este script no Windows, no WSL 2 ou em outro ambiente compatível com o Node.js 20+.${NC}"
    exit 1
fi

# Garante que o script pare se algum comando falhar
set -e

# --- Liberação de Portas ---
free_port() {
    local port=$1
    echo -e "${BLUE}   - Verificando e liberando a porta $1...${NC}"

    # Em WSL, 'lsof' não vê portas ocupadas pelo host do Windows.
    # Usamos 'netstat.exe' para verificar a porta no host se estivermos em WSL.
    if command -v cmd.exe >/dev/null 2>&1; then
        if cmd.exe /c "netstat -ano -p TCP | findstr :${port}.*LISTENING" >/dev/null; then
            echo -e "${RED}     - Erro: A porta ${port} está em uso no host do Windows.${NC}"
            echo -e "${YELLOW}     - Provavelmente um container antigo está ativo. Tente rodar 'docker compose down' e execute o script novamente.${NC}"
            echo -e "${YELLOW}     - Se não resolver, use no PowerShell (Admin): 'Get-Process -Id (Get-NetTCPConnection -LocalPort ${port}).OwningProcess' para encontrar o processo.${NC}"
            exit 1
        fi
    fi

    # Verificação padrão para Linux/macOS ou processos dentro do WSL
    if lsof -i ":${port}" -sTCP:LISTEN -t >/dev/null ; then
        echo -e "${YELLOW}     - Porta ${port} está em uso (dentro do WSL). Tentando liberar...${NC}"
        lsof -t -i ":${port}" | xargs kill -9
        sleep 1 # Dá um tempo para a porta ser liberada
        if lsof -i ":${port}" -sTCP:LISTEN -t >/dev/null ; then
            echo -e "${RED}     - Não foi possível liberar a porta ${port}. Saindo.${NC}"
            exit 1
        fi
        echo -e "${GREEN}     - Porta ${port} liberada com sucesso.${NC}"
    else
        echo -e "${GREEN}     - Porta ${port} já está livre.${NC}"
    fi
}

echo -e "\n${YELLOW}🔎 Verificando e liberando portas necessárias...${NC}"
free_port 3001 # Porta do Backend
free_port 8000 # Porta do Frontend
free_port 8080 # Porta usada pelo Weaviate
free_port 6379 # Porta usada pelo Redis

# --- 1. Iniciar a Infraestrutura (Docker) ---
echo -e "\n${YELLOW}▶️  Iniciando a infraestrutura (Docker)...${NC}"
echo -e "${BLUE}   - Iniciando serviços de infraestrutura (Redis & Weaviate) com Docker...${NC}"
"${COMPOSE_CMD[@]}" -f "${COMPOSE_FILE}" up -d --force-recreate

echo -e "${BLUE}   - Aguardando o Weaviate ficar pronto...${NC}"
# Loop para verificar a saúde do Weaviate antes de continuar
RETRY_COUNT_WEAVIATE=0
MAX_RETRIES_WEAVIATE=15
until $(curl --output /dev/null --silent --fail http://localhost:8080/v1/.well-known/ready); do
    if [ ${RETRY_COUNT_WEAVIATE} -ge ${MAX_RETRIES_WEAVIATE} ]; then
        echo -e "${RED}Erro: O Weaviate não iniciou após ${MAX_RETRIES_WEAVIATE} tentativas.${NC}"
        cleanup
        exit 1
    fi
    printf '.'
    RETRY_COUNT_WEAVIATE=$((RETRY_COUNT_WEAVIATE+1))
    sleep 2
done
echo -e "\n${GREEN}   - Weaviate está pronto!${NC}"

# --- 2. Preparar e Iniciar o Backend ---
echo -e "\n${YELLOW}▶️  Preparando o Backend...${NC}"

if [ ! -d "node_modules" ] || [ "package-lock.json" -nt "node_modules" ]; then
    echo -e "${BLUE}   - Instalando ou atualizando dependências do Node.js (npm install)...${NC}"
    cmd.exe /c "npm install" # Força o uso do npm do Windows via cmd.exe
else
    echo -e "${GREEN}   - Dependências do Node.js já estão atualizadas. Pulando instalação.${NC}"
fi

cd backend

echo -e "${BLUE}   - Iniciando o servidor Backend (Node.js) em background...${NC}"
# Inicia o servidor em background e redireciona a saída para um log
node.exe server.js > ../backend.log 2>&1 & # Força o uso do node.exe do Windows
BACKEND_PID=$!

# Função para parar os processos em background ao sair do script (Ctrl+C)
cleanup() {
    echo -e "\n\n${YELLOW}🛑 Finalizando o ambiente...${NC}"
    if kill -0 $BACKEND_PID 2>/dev/null; then
        kill $BACKEND_PID
    fi
    if [ -n "${FRONTEND_PID:-}" ] && kill -0 $FRONTEND_PID 2>/dev/null; then
        kill $FRONTEND_PID
    fi
    "${COMPOSE_CMD[@]}" -f "${COMPOSE_FILE}" down >/dev/null 2>&1 || true
    # rm -f backend.log # Remove o log antigo
    # Opcional: remover logs ao finalizar. Comentado para manter os logs para depuração.
    # rm -f backend.log frontend.log
    echo -e "${GREEN}Ambiente finalizado.${NC}"
    exit 0
}

trap cleanup SIGINT

# Volta para a raiz do projeto
cd ..

# Limpa o log antigo antes de iniciar
# rm -f backend.log

echo -e "\n${YELLOW}⌛ Aguardando o servidor backend ficar pronto...${NC}"

# Loop para verificar a saúde do backend antes de continuar
RETRY_COUNT=0
MAX_RETRIES=10
until $(curl --output /dev/null --silent --head --fail http://localhost:3001/api/health); do
    if [ ${RETRY_COUNT} -ge ${MAX_RETRIES} ]; then
        echo -e "${RED}Erro: O servidor backend não iniciou após ${MAX_RETRIES} tentativas.${NC}"
        echo -e "${YELLOW}Verifique o log em 'backend.log' para mais detalhes.${NC}"
        cleanup
        exit 1
    fi
    printf '.'
    RETRY_COUNT=$((RETRY_COUNT+1))
    sleep 2
done

echo -e "\n${GREEN}✅ Backend e serviços auxiliares iniciados!${NC}"
echo -e "   - Backend rodando em: ${BLUE}http://localhost:3001${NC}"
echo -e "   - Log do backend em: ${BLUE}backend.log${NC}"

# --- 3. Iniciar o Frontend ---
echo -e "\n${YELLOW}▶️  Iniciando o servidor do Frontend (Vite Dev Server)...${NC}"
echo -e "\n${GREEN}🎉 Ambiente pronto! Acesse a aplicação em: http://localhost:8000${NC}"
echo -e "   - Log do frontend em: ${BLUE}frontend.log${NC}"
echo -e "(Pressione ${YELLOW}Ctrl+C${NC} para finalizar todos os processos)"

# Inicia o servidor frontend em background e redireciona a saída para um log
cmd.exe /c "npm run dev -- --host 0.0.0.0 --port 8000 --strictPort" > frontend.log 2>&1 &
FRONTEND_PID=$!

wait # Espera por Ctrl+C para chamar a função cleanup
