import { StrictMode } from "react"
import { createRoot } from "react-dom/client"

import App from "./App"
import { registerSW } from "virtual:pwa-register"
import "./index.css"

// Declara o build no DOM antes de qualquer render. O rodapé do app mostra
// este valor; é a forma mais rápida de confirmar que o navegador está com o
// bundle novo depois de um deploy, sem depender de inspeção de rede.
const buildId = __BUILD_ID__
document.documentElement.setAttribute("data-build", buildId)
;(window as unknown as { __BUILD_ID__?: string }).__BUILD_ID__ = buildId

registerSW({
  immediate: true,
  // Atualizaçãoavailable não é suficiente: se a página já está com os chunks
  // antigos em memória, trocar o service worker não troca o que já rodou.
  onNeedRefresh() {
    if (window.confirm("Nova versão do CRM disponível. Atualizar agora?")) {
      window.location.reload()
    }
  },
})

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <App />
  </StrictMode>,
)
