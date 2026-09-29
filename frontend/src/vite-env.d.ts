/// <reference types="vite/client" />
/// <reference types="vite-plugin-pwa/client" />

interface BeforeInstallPromptEvent extends Event {
  prompt(): Promise<void>
  userChoice: Promise<{ outcome: "accepted" | "dismissed" }>
}

interface Window {
  __crmPromptInstall?: () => Promise<void>
}

// Injetado pelo vite.config.ts (ver `define.__BUILD_ID__`). Identifica o
// bundle em execução — exibido no rodapé do app e no atributo data-build do
// <html>. Serve para distinguir, em segundos, "código novo com bug" de
// "navegador ainda servindo bundle antigo do cache do PWA".
declare const __BUILD_ID__: string
