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

# Garante que o script pare se algum comando falhar
set -e

# --- Verificação de Portas ---
check_port() {
    if lsof -i :$1 -sTCP:LISTEN -t >/dev/null ; then
        echo -e "${RED}Erro: A porta $1 já está em uso. Por favor, libere a porta e tente novamente.${NC}"
        exit 1
    fi
}

echo -e "\n${YELLOW}🔎 Verificando portas necessárias...${NC}"
check_port 3001 # Porta do Backend
check_port 8000 # Porta do Frontend
echo -e "${GREEN}   - Portas 3001 e 8000 estão livres.${NC}"


# --- 1. Preparar e Iniciar o Backend ---
echo -e "\n${YELLOW}▶️  Preparando o Backend...${NC}"

echo -e "${BLUE}   - Verificando e instalando dependências do Node.js (npm install)...${NC}"
npm install # Instala dependências da raiz, incluindo as do workspace do backend

cd backend
echo -e "${BLUE}   - Iniciando serviços de infraestrutura (Redis & Weaviate) com Docker...${NC}"
"${COMPOSE_CMD[@]}" -f "${COMPOSE_FILE}" up -d

echo -e "${BLUE}   - Iniciando o servidor Backend (Node.js) em background...${NC}"
# Inicia o servidor em background e redireciona a saída para um log
node server.js > ../backend.log 2>&1 &
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

# --- 2. Iniciar o Frontend ---
echo -e "\n${YELLOW}▶️  Iniciando o servidor do Frontend (usando 'serve')...${NC}"
echo -e "\n${GREEN}🎉 Ambiente pronto! Acesse a aplicação em: http://localhost:8000${NC}"
echo -e "(Pressione ${YELLOW}Ctrl+C${NC} para finalizar todos os processos)"

# Usa 'npx serve' que lida melhor com MIME types para .tsx
npx serve -l 8000 . > /dev/null 2>&1 &
FRONTEND_PID=$!

wait # Espera por Ctrl+C para chamar a função cleanup
