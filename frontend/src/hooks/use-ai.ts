import { useState, useCallback } from "react"
import {
  aiSummarizeConversation,
  aiAnalyzeLead,
  aiSuggestReply,
  aiSummarizeClient,
  aiAnalyzeOpportunity,
} from "@/lib/api"
import type { AIConversationSummary, AILeadAnalysis, AISuggestedReply } from "@/lib/types"
import { toast } from "sonner"

export function useAI() {
  const [loading, setLoading] = useState(false)

  const summarizeConversation = useCallback(async (conversationId: string): Promise<AIConversationSummary | null> => {
    setLoading(true)
    try {
      const res = await aiSummarizeConversation(conversationId)
      return res.result
    } catch (e: any) {
      toast.error(e.message ?? "Erro ao resumir conversa")
      return null
    } finally {
      setLoading(false)
    }
  }, [])

  const analyzeLead = useCallback(async (conversationId: string): Promise<AILeadAnalysis | null> => {
    setLoading(true)
    try {
      const res = await aiAnalyzeLead(conversationId)
      return res.result
    } catch (e: any) {
      toast.error(e.message ?? "Erro ao analisar lead")
      return null
    } finally {
      setLoading(false)
    }
  }, [])

  const suggestReply = useCallback(async (conversationId: string, tone?: string): Promise<AISuggestedReply | null> => {
    setLoading(true)
    try {
      const res = await aiSuggestReply(conversationId, tone)
      return res.result
    } catch (e: any) {
      toast.error(e.message ?? "Erro ao sugerir resposta")
      return null
    } finally {
      setLoading(false)
    }
  }, [])

  const summarizeClient = useCallback(async (contactId: string): Promise<string | null> => {
    setLoading(true)
    try {
      const res = await aiSummarizeClient(contactId)
      return res.result
    } catch (e: any) {
      toast.error(e.message ?? "Erro ao resumir cliente")
      return null
    } finally {
      setLoading(false)
    }
  }, [])

  const analyzeOpportunity = useCallback(async (opportunityId: string): Promise<string | null> => {
    setLoading(true)
    try {
      const res = await aiAnalyzeOpportunity(opportunityId)
      return res.result
    } catch (e: any) {
      toast.error(e.message ?? "Erro ao analisar oportunidade")
      return null
    } finally {
      setLoading(false)
    }
  }, [])

  return {
    loading,
    summarizeConversation,
    analyzeLead,
    suggestReply,
    summarizeClient,
    analyzeOpportunity,
  }
}