/** `/fresh` alone (also `/fresh@bot`, any case): start the model on a clean conversation. Anything else is false. */
export const isFresh = (text: string) => /^\s*\/fresh(?:@\w+)?\s*$/i.test(text)

export const freshStub = (msgId: string) => `[fresh turn ${msgId} handled]`
