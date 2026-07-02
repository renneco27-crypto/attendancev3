export async function checkDeveloperOptions(): Promise<{ isDevOptionsOn: boolean }> {
  if (typeof window !== 'undefined' && (window as any).nativeBridge?.checkDeveloperOptions) {
    return new Promise((resolve) => {
      const handler = (e: Event) => {
        const detail = (e as CustomEvent).detail
        if (detail.type === 'DEVELOPER_OPTIONS_RESULT') {
          window.removeEventListener('nativeBridgeMessage', handler)
          resolve({ isDevOptionsOn: detail.isEnabled })
        }
      }
      window.addEventListener('nativeBridgeMessage', handler)
      ;(window as any).nativeBridge.checkDeveloperOptions()
      setTimeout(() => { window.removeEventListener('nativeBridgeMessage', handler); resolve({ isDevOptionsOn: false }) }, 5000)
    })
  }
  return { isDevOptionsOn: false }
}
