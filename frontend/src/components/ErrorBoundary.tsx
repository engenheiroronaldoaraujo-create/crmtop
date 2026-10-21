import { Component, type ErrorInfo, type ReactNode } from "react"
import { Button } from "@/components/ui/button"
import { AlertTriangle, RefreshCw } from "lucide-react"

type Props = {
  children: ReactNode
  /** Nome exibido no erro (ex.: "Chat"). */
  label?: string
}

type State = { error: Error | null }

/**
 * ErrorBoundary de app.
 *
 * Antes não existia nenhum: uma exceção em render (ex.: `opp.stage.color`
 * com `stage` undefined) derrubava a árvore inteira e o usuário via uma
 * tela branca, sem nenhuma forma de recuperação a não ser recarregar.
 */
export class ErrorBoundary extends Component<Props, State> {
  state: State = { error: null }

  static getDerivedStateFromError(error: Error): State {
    return { error }
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    console.error("[ErrorBoundary]", this.props.label ?? "app", error, info.componentStack)
  }

  handleReset = () => {
    this.setState({ error: null })
  }

  render() {
    const { error } = this.state
    if (!error) return this.props.children

    return (
      <div className="flex h-full min-h-[60vh] w-full flex-col items-center justify-center gap-4 p-6 text-center">
        <div className="flex h-12 w-12 items-center justify-center rounded-full bg-destructive/10">
          <AlertTriangle className="h-6 w-6 text-destructive" aria-hidden="true" />
        </div>
        <div className="space-y-1">
          <h2 className="text-lg font-semibold">
            Algo quebrou{this.props.label ? ` no ${this.props.label}` : ""}
          </h2>
          <p className="max-w-md text-sm text-muted-foreground">
            Ocorreu um erro inesperado ao renderizar esta tela. Você pode tentar de novo —
            se o problema persistir, recarregue a página.
          </p>
        </div>
        <pre className="max-w-xl overflow-x-auto rounded-md bg-muted p-3 text-left text-xs text-muted-foreground">
          {error.message}
        </pre>
        <div className="flex gap-2">
          <Button onClick={this.handleReset} variant="outline">
            <RefreshCw className="mr-2 h-4 w-4" aria-hidden="true" />
            Tentar de novo
          </Button>
          <Button onClick={() => window.location.reload()}>Recarregar</Button>
        </div>
      </div>
    )
  }
}
