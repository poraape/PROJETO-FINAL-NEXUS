# Estágio 1: Build
# Usamos uma imagem Node.js completa para instalar as dependências
FROM node:20-alpine AS builder

WORKDIR /usr/src/app

# Copia os arquivos de manifesto do pacote e instala as dependências
COPY ../package.json ../package-lock.json* ./
RUN npm ci

# Estágio 2: Produção
# Usamos uma imagem mais leve para a execução final
FROM node:20-alpine

WORKDIR /usr/src/app

# Copia as dependências instaladas do estágio de build
COPY --from=builder /usr/src/app/node_modules ./node_modules

# Copia o código da aplicação
COPY . .

# Expõe a porta que a aplicação usa
EXPOSE 3001

# Comando para iniciar a aplicação com PM2 (que já está instalado globalmente ou será no ambiente de deploy)
# Nota: Para um deploy real, o PM2 seria instalado aqui ou a imagem base já o conteria.
# Por simplicidade, o comando assume que o PM2 estará disponível.
CMD [ "node", "server.js" ]