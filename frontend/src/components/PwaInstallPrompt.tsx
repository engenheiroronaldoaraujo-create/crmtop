import { useEffect, useState } from "react"

export function PwaInstallPrompt() {
  const [promptEvent, setPromptEvent] = useState<BeforeInstallPromptEvent | null>(null)
  const [visible, setVisible] = useState(false)

  useEffect(() => {
    const handler = (e: Event) => {
      e.preventDefault()
      setPromptEvent(e as BeforeInstallPromptEvent)
      setTimeout(() => setVisible(true), 3000)
    }
    window.addEventListener("beforeinstallprompt", handler)
    return () => window.removeEventListener("beforeinstallprompt", handler)
  }, [])

  if (!promptEvent || !visible) return null

  const install = async () => {
    await promptEvent.prompt()
    setVisible(false)
  }

  return (
    <div className="fixed bottom-4 left-1/2 z-50 -translate-x-1/2 rounded-lg border bg-background px-4 py-3 shadow-lg">
      <p className="mb-2 text-sm">Instale o CRM na tela inicial</p>
      <div className="flex gap-2">
        <button
          onClick={install}
          className="rounded-md bg-primary px-3 py-1.5 text-sm text-primary-foreground"
        >
          Instalar
        </button>
        <button
          onClick={() => setVisible(false)}
          className="rounded-md border px-3 py-1.5 text-sm"
        >
          Agora não
        </button>
      </div>
    </div>
  )
}
