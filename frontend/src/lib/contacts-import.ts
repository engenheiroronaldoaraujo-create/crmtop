// Importação de contatos a partir de arquivo (campanhas).
// Formatos: vCard (.vcf), CSV/TXT (uma linha por contato: "telefone,nome",
// "nome,telefone" ou só o telefone) e planilha Excel (.xlsx/.xls) onde cada
// linha é um contato (procura a célula com telefone e a primeira com nome).
//
// A variante Excel é assíncrona (lê binário com a lib `xlsx`, carregada sob
// demanda para não pesar no bundle inicial).

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

function isExcel(name: string): boolean {
  const n = name.toLowerCase()
  return n.endsWith(".xlsx") || n.endsWith(".xlsm") || n.endsWith(".xls")
}

function makeContact(digits: string, name: string | null, email: string | null): ImportedContact {
  return {
    id: `imp-${digits}`,
    name: name || null,
    phone: digits,
    push_name: null,
    email: email || null,
    contact_tags: null,
    imported: true,
  }
}

// Numa linha de células, identifica telefone (a única com dígitos suficientes),
// nome (a primeira com letras, diferente do telefone) e e-mail (contém @).
export function parseContactRow(cells: unknown[]): ImportedContact | null {
  const values = cells
    .map((c) => (c === null || c === undefined ? "" : String(c).trim()))
    .filter((v) => v.length > 0)
  if (values.length === 0) return null

  const emailIdx = values.findIndex((v) => /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(v))
  const email = emailIdx >= 0 ? values[emailIdx] : null

  const phoneIdx = values.findIndex(
    (v, i) => i !== emailIdx && canonicalDigits(v) !== null && /\d/.test(v),
  )
  if (phoneIdx < 0) return null
  const digits = canonicalDigits(values[phoneIdx])
  if (!digits) return null

  const nameIdx = values.findIndex(
    (v, i) => i !== phoneIdx && i !== emailIdx && /[a-zA-ZÀ-ÿ]/.test(v),
  )
  const name = nameIdx >= 0 ? values[nameIdx] : null

  return makeContact(digits, name, email)
}

function parseDelimitedText(text: string): ImportedContact[] {
  const out: ImportedContact[] = []
  for (const line of text.split(/\r?\n/)) {
    if (!line.trim()) continue
    const tokens = line.split(/[;,\t]/).map((t) => t.trim()).filter(Boolean)
    const c = parseContactRow(tokens)
    if (c) out.push(c)
  }
  return out
}

function parseVcf(text: string): ImportedContact[] {
  const out: ImportedContact[] = []
  for (const card of text.split(/BEGIN:VCARD/i).slice(1)) {
    const tel = card.match(/^TEL[^\n]*:\s*(.+)$/im)?.[1] ?? ""
    const fn = card.match(/^FN[^\n]*:\s*(.+)$/im)?.[1]?.trim() ?? ""
    const d = tel ? canonicalDigits(tel) : null
    if (d) out.push(makeContact(d, fn || null, null))
  }
  return out
}

// Compatível com a API antiga: só para fontes textuais (csv/txt/vcf).
export function parseContactsFile(filename: string, text: string): ImportedContact[] {
  if (filename.toLowerCase().endsWith(".vcf")) return parseVcf(text)
  return parseDelimitedText(text)
}

async function parseExcel(file: File): Promise<ImportedContact[]> {
  const XLSX = await import("xlsx")
  const buf = await file.arrayBuffer()
  const wb = XLSX.read(buf, { type: "array" })
  const sheetName = wb.SheetNames[0]
  const sheet = sheetName ? wb.Sheets[sheetName] : undefined
  if (!sheet) return []
  const rows = XLSX.utils.sheet_to_json<unknown[]>(sheet, {
    header: 1,
    blankrows: false,
    defval: "",
    raw: false,
  })
  const out: ImportedContact[] = []
  for (const row of rows) {
    const c = parseContactRow(Array.isArray(row) ? row : [row])
    if (c) out.push(c)
  }
  return out
}

// Ponto de entrada do wizard: escolhe o parser pelo tipo/nome do arquivo e
// devolve os contatos (Excel é lido como binário; o resto como texto).
export async function parseContactsFromFiles(files: File[]): Promise<ImportedContact[]> {
  const out: ImportedContact[] = []
  for (const file of files) {
    if (isExcel(file.name)) {
      out.push(...(await parseExcel(file)))
    } else {
      out.push(...parseContactsFile(file.name, await file.text()))
    }
  }
  return out
}
