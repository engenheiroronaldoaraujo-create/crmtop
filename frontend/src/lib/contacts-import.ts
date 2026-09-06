// Importação de contatos a partir de arquivo (campanhas).
// Formatos: vCard (.vcf) e CSV/TXT com uma linha por contato
// ("telefone,nome", "nome,telefone" ou apenas o telefone).

export type ImportedContact = {
  id: string
  name: string | null
  push_name: string | null
  phone: string | null
  email: string | null
  contact_tags: Array<{ tag_id: string }> | null
  imported: true
}

// Canonicaliza para o padrão do banco (dígitos com DDI; assume 55 BR quando
// o arquivo traz DDD+número sem código de país).
export function canonicalDigits(raw: string): string | null {
  const d = raw.replace(/\D/g, "")
  if (d.length === 10 || d.length === 11) return `55${d}`
  if (d.length >= 12 && d.length <= 15) return d
  return null
}

export function parseContactsFile(filename: string, text: string): ImportedContact[] {
  const out: ImportedContact[] = []
  const isVcf = filename.toLowerCase().endsWith(".vcf")
  if (isVcf) {
    for (const card of text.split(/BEGIN:VCARD/i).slice(1)) {
      const tel = card.match(/^TEL[^\n]*:\s*(.+)$/im)?.[1] ?? ""
      const fn = card.match(/^FN[^\n]*:\s*(.+)$/im)?.[1]?.trim() ?? ""
      const d = tel ? canonicalDigits(tel) : null
      if (d) {
        out.push({
          id: `imp-${d}`,
          name: fn || null,
          phone: d,
          push_name: null,
          email: null,
          contact_tags: null,
          imported: true,
        })
      }
    }
    return out
  }
  for (const line of text.split(/\r?\n/)) {
    if (!line.trim()) continue
    const tokens = line.split(/[;,\t]/).map((t) => t.trim()).filter(Boolean)
    if (tokens.length === 0) continue
    const phoneToken = tokens.find((t) => canonicalDigits(t)?.length)
    if (!phoneToken) continue // cabeçalho ou linha sem telefone
    const d = canonicalDigits(phoneToken)
    if (!d) continue
    const name = tokens.find((t) => t !== phoneToken && /[a-zA-ZÀ-ÿ]/.test(t)) ?? null
    out.push({
      id: `imp-${d}`,
      name,
      phone: d,
      push_name: null,
      email: null,
      contact_tags: null,
      imported: true,
    })
  }
  return out
}
