FROM node:22-alpine AS frontend-builder
WORKDIR /app/frontend
COPY frontend/package*.json ./
RUN npm install
COPY frontend/ .
RUN npm run build

FROM golang:1.26-alpine AS backend-builder
WORKDIR /app

COPY go.mod go.sum ./
RUN go mod download
COPY . .

ARG VERSION=dev

RUN mkdir -p frontend/dist
COPY --from=frontend-builder /app/frontend/dist ./frontend/dist
RUN go build -ldflags="-s -w -X 'main.Version=${VERSION}'" -o router-manager .

FROM alpine:latest
WORKDIR /app
COPY --from=backend-builder /app/router-manager .

EXPOSE 8080
CMD ["./router-manager"]
