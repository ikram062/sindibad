const KEY = 'sindibad.prompt'

/** Opens the chat and sends `text` as the user's first message (used by "ask about this" buttons on other screens). */
export function queuePrompt(text: string) {
  try {
    sessionStorage.setItem(KEY, text)
  } catch {
    // private mode: the chat just opens without the prefilled message
  }
  location.hash = '#/chat'
}

/** Looks at the queued prompt without removing it. Removal happens only once it has really been sent. */
export function peekPrompt(): string | null {
  try {
    return sessionStorage.getItem(KEY)
  } catch {
    return null
  }
}

export function clearPrompt() {
  try {
    sessionStorage.removeItem(KEY)
  } catch {
    // nothing to clear
  }
}
