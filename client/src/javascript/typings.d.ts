declare module '*.md' {
  const value: string;
  export default value;
}

declare module '@lingui/loader!*.json?raw-lingui' {
  export const messages: Record<string, string[]>;
}

declare global {
  // Non-standard WebKit Force Touch events (macOS Safari/WebKit only)
  interface HTMLElementEventMap {
    webkitmouseforcewillbegin: MouseEvent;
    webkitmouseforcechanged: MouseEvent;
    webkitmouseforcedown: MouseEvent;
    webkitmouseforceup: MouseEvent;
  }

  interface DocumentEventMap {
    webkitmouseforcewillbegin: MouseEvent;
    webkitmouseforcechanged: MouseEvent;
    webkitmouseforcedown: MouseEvent;
    webkitmouseforceup: MouseEvent;
  }
}
